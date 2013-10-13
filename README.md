# PlayRTC

**Start your room-based real time app (WebRTC Data Channel & WebSocket) in minutes with Play Framework 2.2**

PlayRTC gives you out-of-the-box rooms where members can send P2P messages to each other via WebRTC SCTP Data Channels, and communicate with the server via Websocket. It also provides automatic heartbeats.

The P2P topology is for now \* to \* (every member is connected to every member). However you can build a custom topology (an overlay network) on top of this. A future version may allow to define a custom topology *before* the P2P connection part to avoid making useless P2P connections.

## Client side
You need to include ```playrtc.js``` (or ```playrtc.min.js```) which exposes a global ```Playrtc``` object. You can find it in ```client/``` (a Bower and NPM/Browserify version will be available soon).
It depends on [backbone-events-standalone](https://github.com/n1k0/backbone-events-standalone), so make sure to include ```backbone-events-standalone.js``` too.

```js
var io = Playrtc.connect('ws://<your_websocket_endpoint>');
var p2p = io.p2p;
var server = io.server;
```

```io```, ```p2p``` and ```server``` are Event Emitters extending the Backbone.Events model. Take a look [there](http://backbonejs.org/#Events) to see all the methods that you can use with a Backbone event emitter.

```Playrtc.connect(wsEndpoint, config)``` can optionally take a ```config``` object. ```config.webrtcConfig``` allows to define a custom Webrtc config (default to ```{'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]}```).

```Playrtc.isCompatible()``` return true if the browser is compatible with SCTP Data Channels.

### io
```io``` is an event emitter object that emits all the room-related control events.

```js
io.on('ready', function() {
  // Connected to the server and to every other members (P2P connection phase finished)
  trace('My id: ' + io.id);
  trace('Other members: ' + io.members); // Array of other member ids
});

io.on('newmember', function(id) {
  trace('New member: ' + id);
});

io.on('memberleft', function(id) {
  trace('Member left: ' + id);
});
```

### server
```server``` is an event emitter object that emits events (messages) coming from the server.

```server.send(eventName, data)``` allows to send a message to the server.

```js
io.on('ready', function() {
  server.send('ping', {'msg': 'pingmsg'});
});

server.on('pong', function(data) {
  trace('Server Pong msg: ' + data.msg);
});
```

### p2p
```p2p``` is an event emitter object that emits events (messages) coming from peers.

```p2p.send(peerId, eventName, data)``` allows to send a P2P message to a peer.

```p2p.broadcast(eventName, data)``` allows to broadcast a P2P message to all other room members.

```js
io.on('ready', function() {
  p2p.broadcast('ping', {'msg': 'pingmsg'});
});

p2p.on('ping', function(from, data) {
  trace('P2P ping msg from ' + from +': ' + data.msg);
  var to = from;
  p2p.send(to, 'pong', {'msg': 'pongmsg'});
});

p2p.on('pong', function(from, data) {
  trace('P2P pong msg from ' + from +': ' + data.msg);
});
```

  
Take a look at [main.js](https://github.com/atamborrino/PlayRTC/blob/master/example/app/assets/javascripts/main.js) in the example app folder for an all-together example.

## Server side
The server side code is heavily inspired by [play-actor-room](https://github.com/mandubian/play-actor-room). PlayRTC was originally on top of it, but as I found myself re-writing many internal stuffs to adapt it to PlayRTC, I eventually ended up re-writing the code parts of play-actor-room that PlayRTC is using.

As in [play-actor-room](https://github.com/mandubian/play-actor-room), each member is represented by 2 actors: a receiver and a sender. For each room there is 1 supervisor which is the parent of the receivers and senders of the members of this room.

Add the following resolver and library to your build.sbt:
```scala
resolvers += "Atamborrino repository snapshots" at "https://github.com/atamborrino/maven-atamborrino/raw/master/snapshots/"
libraryDependencies += "com.github.atamborrino" %% "playrtc" % "0.1-SNAPSHOT"
```

Then, you must define a receiver to handle incoming messages:
```scala
import com.github.atamborrino.playrtc._

class MyReceiver(id: String) extends Receiver(id) {
  import context._
  
  def customReceive: Receive = {
    case Ready =>
      // Member of id = this.id is connected to every other members via Data Channels
      Logger.info(s"Member of id = $id is ready")
      // do some initialization server side...
       
    case Msg("ping", data: JsValue) =>
      val maybePong = (data \ "msg").asOpt[String] map { pingmsg =>
        val pongdata = Json.obj("msg" -> "pongmsg")
        Msg("pong", pongdata)
      }
      maybePong.foreach(parent ! Send(id, _))

    case Msg("processThenBroadcast", dataToProcess: JsObject) =>
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

A receiver can also ask his supervisor for the list of room members ```parent ! ListMembersIds```and he will receive a message of type ```MemberIds(ids: Seq[String])```.

Heartbeats' interval and delay are respectively 7 seconds and 3 seconds. You can change them by overriding their values in your receiver actor:
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

```websocket[MyReceiver](userid)``` returns a ```(Iteratee[JsValue, Unit], Enumerator[JsValue])```. Note that if you want to use custom Props, you can use ```websocket(userid, myReceiverProps)```.

But your app usually needs several rooms. To do this you can for example create an actor that stores a map of roomId -> room, and then ask him for the room of id = roomdId. In thise case you will retrieve a room asynchronously:
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
