/*
 * Copyright 2013 Alexandre Tamborrino (@altamborrino)
 * 
 * Some code has been taken from https://github.com/mandubian/play-actor-room created by @mandubian
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.github.atamborrino.playrtc

import play.api.libs.json._
import play.api.libs.functional.syntax._
import akka.actor._
import play.api._
import akka.event.Logging
import play.api.mvc._
import scala.concurrent.duration._
import play.api.mvc.WebSocket.FrameFormatter
import scala.concurrent._
import akka.pattern.{ask, pipe}
import play.api.libs.iteratee._
import akka.util.Timeout
import play.api.libs.concurrent.Akka

// User (public) messages
case class Msg(event: String, data: JsValue)
object Msg {
  implicit val read = Json.reads[Msg]
  implicit val write = Json.writes[Msg]
}

case class Send(to: String, m: Msg)
case class Broadcast(m: Msg)
case object Ready
case object ListMembersIds
case class MemberIds(ids: Seq[String])

case class Member(id: String, val receiver: ActorRef, val sender: ActorRef)

// Admin messages
object Admin {
  case class Msg(adminEvent: String, data: JsValue)
  object Msg {
    implicit val read = Json.reads[Admin.Msg]
    implicit val write = Json.writes[Admin.Msg]
  }
  
  case class Send(to: String, m: Admin.Msg)
  case class Broadcast(m: Admin.Msg)
  case object Disconnect
  case object HbTimeout
  case class Ready(id: String)
  case class ConnectWS(id: String, receiverProps: Props, senderProps: Props)
  case class ConnectedWS(id: String, receiver: ActorRef, enumerator: Enumerator[JsValue])
  case class Init(id: String, receiverActor: ActorRef)
  case class Disconnected(id: String)  
  case class Forbidden(id: String, err: String)
  case object WebrtcHandshakeInit
  case object StartTimeout
}

class Receiver(id: String) extends Actor {
  import context._
  
  val HB_INTERVAL = 7 seconds
  val HB_DELAY = 3 seconds
  val log = Logging(system, Receiver.this)
  private var hbTimeout: Option[Cancellable] = None
    
  def receive = {
    case msg: Admin.Msg => handleAdminMsg(msg)
    
    case Admin.HbTimeout =>
        parent ! Admin.Disconnected(id)
        
    case Admin.Disconnected(_) =>
      hbTimeout.foreach(_.cancel())
      
    case Admin.WebrtcHandshakeInit =>
      parent ! Admin.Send(id, Admin.Msg("initInfo", Json.obj("id" -> id, "hbInterval" -> HB_INTERVAL.toMillis)))
    
    case Admin.StartTimeout =>
      hbTimeout = Some(system.scheduler.scheduleOnce(2*HB_DELAY + HB_INTERVAL, self, Admin.HbTimeout))
    
  }
  
  private def handleAdminMsg(msg: Admin.Msg): Unit = msg match {
    
    case Admin.Msg("hb", _) =>
      hbTimeout.foreach(_.cancel())
      hbTimeout = Some(system.scheduler.scheduleOnce(HB_DELAY + HB_INTERVAL, self, Admin.HbTimeout))
    
    case Admin.Msg("fwd", data) =>
      for {
        to <- (data \ "to").asOpt[String]
        fwdMsg <- (data \ "msg").asOpt[JsValue]
        adminMsg <- fwdMsg.validate[Admin.Msg].asOpt
      } parent ! Admin.Send(to, adminMsg)
      
    case Admin.Msg("ready", _) =>
      parent ! Admin.Ready(id)
      self ! Ready
    
  } 
  
}

class Room(supervisorProps: Props)(implicit app: Application) {
  import play.api.libs.concurrent.Execution.Implicits._
  
  lazy val supervisor = Akka.system.actorOf(supervisorProps)
  
  def websocket[T <: Receiver](id: String)(implicit tag: scala.reflect.ClassTag[T]) 
      : (Iteratee[JsValue, Unit], Enumerator[JsValue]) = {
    val senderProps = Props(classOf[WebSocketSender])
    websocket(id, Props(tag.runtimeClass, id), senderProps)
  }
  
  def websocket(id: String, receiverProps: Props): (Iteratee[JsValue, Unit], Enumerator[JsValue]) = {
    val senderProps = Props(classOf[WebSocketSender])
    websocket(id, receiverProps, senderProps)
  }
  
  private def websocket(id: String, receiverProps: Props, senderProps: Props)
      (implicit frameFormatter: FrameFormatter[JsValue]): (Iteratee[JsValue, Unit], Enumerator[JsValue]) = {

    implicit val timeout = Timeout(1 second)

    val futureItEnum = (supervisor ? Admin.ConnectWS(id, receiverProps, senderProps)).map {
      case c: Admin.ConnectedWS =>
        val iteratee = Iteratee.foreach[JsValue] { js =>
          js.validate[Admin.Msg].fold(
            _ => {
              js.validate[Msg].fold(
                err => Logger.error("Error parsing incoming json: " + err),
                msg => c.receiver ! msg
              )
            },
            adminMsg => c.receiver ! adminMsg
           )
        }.map { _ =>
          supervisor ! Admin.Disconnected(id)
        }
        (iteratee, c.enumerator)

      case Admin.Forbidden(id, error) =>
        // Connection error
        // A finished Iteratee sending EOF
        val iteratee = Done[JsValue, Unit]((), Input.EOF)

        // Send an error and close the socket
        val enumerator = Enumerator[JsValue](
            Json.toJson(Msg("error", Json.obj("id" -> id, "msg" -> s"id $id already connected")))
        ).andThen(Enumerator.enumInput(Input.EOF))

        (iteratee, enumerator)
    }

    val it = Iteratee.flatten(futureItEnum.map(_._1))
    val enum = Enumerator.flatten(futureItEnum.map(_._2))
    (it, enum)
  }
  
}

object Room {
  def apply()(implicit app: Application): Room =
    new Room(Props[Supervisor])(app)

  def apply(supervisorProps: Props)(implicit app: Application): Room =
    new Room(supervisorProps)(app)
}

class Supervisor extends Actor {
  import context._
  val log = Logging(system, Supervisor.this)
  
  private var wsMembers = Map.empty[String, Member] // members that are Websocket-connected
  private var notYetInitiatedMembers = Set.empty[String] // members that are Websocket-connected 
                                                        // but not the WebRTC hand-shake has not begun
  var members = Map.empty[String, Member] // *ready* members (WebRTC-connected to each others)
  
  def receive = {
    case m @ Send(to, _) => members.get(to).foreach(_.sender ! m)
    case Broadcast(m) => members foreach {
      case (id, member) => member.sender ! Send(id, Msg(m.event, m.data))
    }
    
    case Admin.Send(to, Admin.Msg(event @ "initInfo", js: JsObject)) =>
      wsMembers.get(to) foreach { member =>
        val ids = Json.obj("members" -> wsMembers.keySet.diff(notYetInitiatedMembers))
	member.sender ! Admin.Send(to, Admin.Msg(event, js ++ ids))
        notYetInitiatedMembers -= to
      }
      
    case m @ Admin.Send(to, _) => wsMembers.get(m.to).foreach(_.sender ! m)
    
    case Admin.Broadcast(m) => wsMembers foreach {
      case (id, member) => member.sender ! Admin.Send(id, Admin.Msg(m.adminEvent, m.data))
    }
    
    case Admin.Ready(id) =>
      wsMembers.get(id).foreach(member => members = members + (id -> member))
      
    case Admin.ConnectWS(id, receiverProps, senderProps) =>
      if(wsMembers.contains(id)) sender ! Admin.Forbidden(id, "id already connected")
      else {
        implicit val timeout = Timeout(1 second)
        val receiveActor = context.actorOf(receiverProps, id+"-receiver")
        val sendActor = context.actorOf(senderProps, id+"-sender")

        val c = (sendActor ? Admin.Init(id, receiveActor)).map{
          case c: Admin.ConnectedWS =>
            play.Logger.debug(s"Connected Member with ID:$id")
            wsMembers += (id -> Member(id, receiveActor, sendActor))
            notYetInitiatedMembers += id 
            receiveActor ! Admin.StartTimeout
            c
        }

        c pipeTo sender
      }
    
    case Admin.Disconnected(id) =>
      wsMembers.get(id) foreach { m =>
        wsMembers -= id
        members -= id
        notYetInitiatedMembers -= id
        m.sender ! Admin.Disconnected(id)
        m.receiver ! Admin.Disconnected(id)
        m.receiver ! PoisonPill
        m.sender ! PoisonPill
      }
      
    case ListMembersIds =>
      sender ! MemberIds(members.keys.toSeq)
      
  }
  
}

class WebSocketSender extends Actor {
  import context._
  
  var channel: Option[Concurrent.Channel[JsValue]] = None

  def receive = {
    case Admin.Init(id, receiverActor) =>
      val me = self
      val enumerator = Concurrent.unicast[JsValue]{ c =>
        channel = Some(c)
        receiverActor ! Admin.WebrtcHandshakeInit
      }
      sender ! Admin.ConnectedWS(id, receiverActor, enumerator)

    case Send(_, msg) => channel.foreach(_.push(Json.toJson(msg)))    
    case Admin.Send(_, msg) => channel.foreach(_.push(Json.toJson(msg)))

    case Admin.Disconnected(id) =>
      val msg = Admin.Msg("disconnect", Json.obj("id" -> id))
      parent ! Admin.Broadcast(msg)
      play.Logger.info(s"Disconnected ID:$id")
  }

  override def postStop() {
    channel.foreach(_.push(Input.EOF))
  }

}

