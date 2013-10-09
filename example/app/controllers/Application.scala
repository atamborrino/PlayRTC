package controllers

import akka.actor._
import play.api._
import play.api.mvc._
import play.api.libs.json._
import play.api.Play.current
import java.util.UUID
import play.Logger
import com.github.atamborrino.playrtc._
import play.api.libs.concurrent.Akka
import akka.pattern.{ask, pipe}
import akka.util.Timeout
import scala.concurrent.duration._

class MyReceiver(id: String) extends Receiver(id) {
  import context._
  
  def customReceive: Receive = {
    case Ready =>
      // do some initialization server side...
      Logger.info(s"Member of id = $id is ready")
       
    case Msg("ping", data: JsValue) =>
      val maybePong = (data \ "msg").asOpt[String] map { pingmsg =>
        val pongdata = Json.obj("msg" -> "pongmsg")
        Msg("pong", pongdata)
      }
      maybePong.foreach(parent ! Send(id, _))

    case Msg("processThenBroadcast", dataToProcess: JsString) =>
      // process dataToProcess server side...
      val processed = Msg("broadcastedFromServer", Json.obj("processedData" -> "processed data"))
      parent ! Broadcast(processed) // Broadcast to every member (including ourself)
      
       // Ask for the list of ready members
      parent ! ListMembersIds
      
    case MemberIds(ids) =>
      // Receive the list of ready members
      Logger.info("Ready members:" + ids.foldLeft("")(_ + " " + _))
      
      // Custom message with MySupervisor
      parent ! CustomMsg
      
    case CustomMsgAnswer =>
      Logger.info(s"Member $id received custom msg from supervisor")
    
  }
  
  override def receive = customReceive orElse super.receive
  
  override def postStop() {
    Logger.info(s"Cleaning after disconnection of $id")
  }
}

case object CustomMsg
case object CustomMsgAnswer

class MySupervisor extends Supervisor {
  def customReceive: Receive = {
    case CustomMsg =>
      sender ! CustomMsgAnswer
  }
  
  override def receive = customReceive orElse super.receive
}

case class GetOrElseCreateRoom(id: String)

class Rooms extends Actor {
  var rooms = Map.empty[String, Room]
  
  def receive = {
    case GetOrElseCreateRoom(id) =>
      val room = rooms.getOrElse(id, {
        val newRoom = Room(Props[MySupervisor])
        rooms = rooms + (id -> newRoom)
        newRoom
      })
      sender ! room    
  }
  
}

object Application extends Controller {
  import play.api.libs.concurrent.Execution.Implicits._
  
  val rooms = Akka.system.actorOf(Props[Rooms])
  
  def index = Action {
    Ok(views.html.index())    
  }
  
  def room(id: String) = Action {
    Ok(views.html.room())
  }
  
  def websocket(id: String) = WebSocket.async { _ =>
    implicit val timeout = Timeout(1 second)
    val futureRoom = (rooms ? GetOrElseCreateRoom(id)).mapTo[Room]
    val userid = UUID.randomUUID().toString()
      
    futureRoom.map(_.websocket[MyReceiver](userid))
  }

  // Sync example. Not used in this app
  val uniqueRoom = Room()

  def websocketSync = WebSocket.using { req =>
    val userid = UUID.randomUUID().toString()
    uniqueRoom.websocket[MyReceiver](userid)
  }
} 
