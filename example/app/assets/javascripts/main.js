$("#connect").click(function() {
  $("#connect").hide();
  $("#log").show();

  if (Playrtc.isCompatible()) {
    var io = Playrtc.connect('ws://localhost:9000' + window.location.pathname + '/ws');
    var p2p = io.p2p;
    var server = io.server;

    io.on('ready', function() {
      trace('My id: ' + io.id);
      trace('Other members: ' + io.members); // Array of other member ids (which are ready)

      var data = {'msg': 'pingmsg'};
      server.send('ping', data); // Send to server
      p2p.broadcast('ping', data); // P2P broadcast to all other members

      server.send('processThenBroadcast', 'some data');
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

    server.onMsg('broadcastedFromServer', function(data) {
      trace('Broadcasted data from server: ' + data.processedData)
    });
    
  }

  function trace(str) {
    console.log(str);
  }

});
