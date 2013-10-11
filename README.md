# PlayRTC

**Start your room-based real time app (WebSocket & WebRTC Data Channel) in minutes with Play Framework!**

PlayRTC gives you out-of-the-box rooms where members can send P2P messages between each others via SCTP Data channels, and communicate with the server via Websocket. It provides also automatic heartbeats.

## Client side
You need to include ```playrtc.js``` or ```playrtc.min.js``` which exposes a global Playrtc object.
```js
var io = Playrtc.connect('ws://<your_websocket_endpoint>');
var p2p = io.p2p;
var server = io.server;

io.on('ready', function() {
  // Connected to the server and to every other members
  trace('My id: ' + io.id);
  trace('Other members: ' + io.members); // Array of other member ids

  var data = {'msg': 'pingmsg'};
  server.send('ping', data); // Send to server
  p2p.broadcast('ping', data); // P2P broadcast to all other members
});

p2p.onMsg('ping', function(from, data) {
  trace('P2P ping msg from ' + from +': ' + data.msg);
  var to = from;
  p2p.send(to, 'pong', {'msg': 'pongmsg'});
});

p2p.onMsg('pong', function(from, data) {
  trace('P2P pong msg from ' + from +': ' + data.msg);
});

server.onMsg('pong', function(data) {
  trace('Server Pong msg: ' + data.msg);
});

// Other control events
io.on('newMember', function(id) {
  trace('New member: ' + id);
});

io.on('memberLeft', function(id) {
  trace('Member left: ' + id);
});
```

You can use the function ```Playrtc.isCompatible()``` to detect if the browser is compatible with SCTP Data channels.

## Server side
The server side code is strongly inspired by [play-actor-room](https://github.com/mandubian/play-actor-room). PlayRTC was originally on top of it, but as I found myself re-writing many internal stuffs to adapt it to PlayRTC, I eventually re-wrote the code parts of play-actor-room that PlayRTC is using.

As in [play-actor-room](https://github.com/mandubian/play-actor-room), each member is represented by 2 actors: a receiver and a sender. For each room there is 1 supervisor which is the parent of the receivers and senders.

To use it, add the following resolver and library:
```scala
resolvers += "Atamborrino repo" at "TODO"
libraryDependencies += "com.github.atamborrino" %% "playrtc" % 0.1
```

You must define a receiver:
```scala
import com.github.atamborrino.playrtc._

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
  }

  override def receive = customReceive orElse super.receive // don't forget this !

  override def postStop() {
    // Disconnection...
  }

}
```

A receiver can also ask his supervisor for the list of members ```parent ! ListMembersIds```and he will receive a message of type ```MemberIds(ids: Seq[String])```.

Heartbeat interval and delay are respectively 7 seconds and 3 seconds. You can change them by overriding their values in your receiver actor:
```scala
import scala.concurrent.duration._

override val HB_INTERVAL = 10 seconds
override val HB_DELAY = 5 seconds
```

To connect everything, you just need to create your websocket endpoint in a Play controller.
Example when the app contains only one room:
```scala
val uniqueRoom = Room()

def websocket = WebSocket.using { req =>
  val userid = // generate user id
  uniqueRoom.websocket[MyReceiver](userid)
}
```

```websocket[MyReceiver](userid)``` returns a ```(Iteratee[JsValue, Unit], Enumerator[JsValue])```. Note that if you want to use custom Props, you can use 
```websocket(userid, myReceiverProps)```.

But your app usually needs several rooms. You can for example create an actor that stores a map of roomId -> room, and then ask him for the room with roomdId. In thise case you will retrieve a room asynchronously:
```scala
def websocket(roomId: String) = WebSocket.async { req =>
  val futureRoom = // ask for the room of id = roomId
  val userid = // generate user id
    
  futureRoom.map(_.websocket[MyReceiver](userid))
}
```

That's it! A fully-implemented example app is located in the example folder.

Note that *if* you need more customization, you can override the Supervisor:
```scala
class MySupervisor extends Supervisor {
  def customReceive = {
    case CustomMsg => // Your custom msg, sent from a receiver for example
      sender ! CustomMsgAnswer // send an answer to the receiver

    case Broadcast(msg) =>
     val newMsg = // modify original msg
     readyMembers foreach { // readyMembers is a Map[String, Member] (id -> member)
      case (id, member) => member.sender ! Send(id, newMsg)
     }
  }
  
  override def receive = customReceive orElse super.receive
}
```

To use your new Supervisor, just pass it as a parameter when your create a Room:
```scala
val room = Room(Props[MySupervisor])
```

## Browser support
- Chrome M31+
- Firefox soon, as soon as the SCTP Data channel interop with Chrome works (see [this Chrome's bug](https://code.google.com/p/chromium/issues/detail?id=295771))

## License
This software is licensed under the Apache 2 license, quoted below.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
