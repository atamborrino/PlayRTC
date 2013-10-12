/*
 * Copyright 2013 Alexandre Tamborrino (@altamborrino)
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

 (function (definition) {
     if (typeof exports === "object") {
         module.exports = definition();
     } else {
         window.Playrtc = definition();
     }
 })(function() {
  'use strict';

  var playrtc = {};

  var DEFAULT_TURN_STUN_CONFIG = {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};
  var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

  playrtc.isCompatible = function() {
    if (navigator.mozGetUserMedia) {
      console.warn('Firefox is not supported for now...');
      return false;
    } else if (navigator.webkitGetUserMedia){
      var webrtcDetectedVersion = parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2], 10);
      if (webrtcDetectedVersion < 31) {
        console.warn('Only Chrome >= M31 is supported (due to the use of SCTP-based datachannels)');
        return false;
      } else {
        return true;
      }
    } else {
      console.warn('Your browser not supported...');
      return false;
    }
  };

  playrtc.connect = function(url, config) {
    var webrtcConfig = config !== undefined ? config : DEFAULT_TURN_STUN_CONFIG;
    return new Playrtc(url, webrtcConfig);
  };

  // Helper 
  function adminMsg(kind, data) {
    return JSON.stringify({'adminKind':kind, 'data':data});
  }

  function usrMsg(kind, data) {
    return JSON.stringify({'kind':kind, 'data':data});
  }

  function p2pUsrMsg(from, kind, data) {
    return JSON.stringify({'from': from, 'kind':kind, 'data':data});
  }

  function fwdMsg(to, kind, data) {
    return JSON.stringify({'adminKind': 'fwd', 'data': {'to':to, 'msg': {'adminKind': kind, 'data': data}}});
  }

  // Main object
  function Playrtc(url, webrtcConfig) {
    var self = this;

    // public
    self.server = {};
    self.p2p = {};
    self.id = undefined;
    self.webrtcConfig = webrtcConfig;
    self.ready = false;

    // private
    self._members = {}; // id -> {'peerconn': ..., 'datachannel': ...}
    self._initialMembers = [];
    self._ws = new WebSocket(url);
    self._eventCbs = {};
    self._readyEvtName = 'ready';
    self._connectEvtName = 'newMember';
    self._disconnectEvtName = 'memberLeft';
    self.server._msgCbs = {}; // WS user callbacks
    self.p2p._msgCbs = {}; // P2P user callbacks

    self._ws.onmessage = function(event) {
      // console.log(event.data);
      var json = JSON.parse(event.data);
      if (json.hasOwnProperty('kind')) {
        // user kind
        if (self.server._msgCbs.hasOwnProperty(json.kind)) {
          self.server._msgCbs[json.kind].call(null, json.data);
        } else {
          console.error('Received unknow kind: ' + json.kind);
        }
      } else {
        // admin kind
        var kind = json.adminKind;
        var data = json.data;

        if (kind === 'initInfo') {
          self.id = data.id; // receveid own id 
          self._initialMembers = data.members;
          if (data.members.length === 0) {
            self._triggerReady();
          } else {
            data.members.forEach(function(id) {
              if (!self._members.hasOwnProperty(id)) {
                self._initiateWebRtcHandshake(id);
              }
            });
          }
          // heartbeat
          setInterval(function() {
               self._ws.send(adminMsg('hb', null)); 
            }, data.hbInterval);
        }

        else if (kind === 'sdpOffer') {
          self._answerWebRtcHandshake(data.from, data.sdp);
        }

        else if (kind === 'sdpAnswer') {
          self._members[data.from].peerconn.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }

        else if(kind === 'iceCandidate') {
          if (self._members.hasOwnProperty(data.from)) {
            self._members[data.from].peerconn.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            console.error('ICE candidate sent before sdp-offer!');
          }
        }

        else if (kind === 'disconnect') {
          if (self._members.hasOwnProperty(data.id)) {
            try {
              self._members[data.id].datachannel.close();
              self._members[data.id].peerconn.close();
            } catch(err) {}
            delete self._members[data.id];
            if (self._eventCbs.hasOwnProperty(self._disconnectEvtName)) {
              self._eventCbs[self._disconnectEvtName].call(null, data.id);
            }
            if (self._isReady()) {
              self._triggerReady();
            }
          }
        }

      }
    };

    self.server.onMsg = function(kind, cb) {
      self.server._msgCbs[kind] = cb;
    };

    self.server.send = function(kind, data) {
      self._ws.send(usrMsg(kind, data));
    };

    self.p2p.onMsg = function(kind, cb) {
      self.p2p._msgCbs[kind] = cb;
    };

    self.p2p.send = function(to, kind, data) {
      if (self._members.hasOwnProperty(to)) {
        self._members[to].datachannel.send(p2pUsrMsg(self.id, kind, data));
      } else {
        console.warn('Tried to send ' + kind + ' ' + JSON.stringify(data) + ' to a unknow member id: ' + to);
      }
    };    

    self.p2p.broadcast = function(kind, data) {
      self.members.forEach(function(id) {
        self._members[id].datachannel.send(p2pUsrMsg(self.id, kind, data));
      });
    };

  }

  Object.defineProperty(Playrtc.prototype, "members", {
      get: function members() {
        var self = this;
        var readyMembers = [];
        for(var id in self._members) {
          if (self._members.hasOwnProperty(id) && self._members[id].datachannel !== null) {
            readyMembers.push(id);
          }
        }
        return readyMembers;
      }
    });

  Playrtc.prototype.on = function(event, cb) {
    this._eventCbs[event] = cb;
  };

  Playrtc.prototype._initiateWebRtcHandshake = function(id) {
    var self = this;

    var memberPeerConn = new RTCPeerConnection(self.webrtcConfig, {optional: [{DtlsSrtpKeyAgreement: true}]});
    memberPeerConn.onicecandidate = function(iceEvt) {
      if (iceEvt.candidate) {
        self._ws.send(fwdMsg(id, 'iceCandidate', {'from': self.id,'candidate': iceEvt.candidate}));
      }
    };
    memberPeerConn.onnegotiationneeded = function() {
      memberPeerConn.createOffer(function(desc){
        memberPeerConn.setLocalDescription(desc, function() {
          self._ws.send(fwdMsg(id, 'sdpOffer', {'from':self.id, 'sdp': desc}));
        });
      });
    };

    self._members[id] = {'peerconn': memberPeerConn, 'datachannel': null};

    var datachannel = memberPeerConn.createDataChannel('playrtc', {reliable : true});

    datachannel.onopen = function(event) {
      self._members[id].datachannel = datachannel;

      if (self._isReady()) {
        self._triggerReady();
      }
    };
    datachannel.onmessage = function(event) {
      self._handleP2PMsg(event);
    };

  };

  Playrtc.prototype._answerWebRtcHandshake = function(id, sdp) {
    var self = this;

    var memberPeerConn = new RTCPeerConnection(self.webrtcConfig, {optional: [{DtlsSrtpKeyAgreement: true}]});
    self._members[id] = {'peerconn': memberPeerConn, 'datachannel': null};

    memberPeerConn.onicecandidate = function(iceEvt) {
      if (iceEvt.candidate) {
        self._ws.send(fwdMsg(id, 'iceCandidate', {'from': self.id,'candidate': iceEvt.candidate}));
      }
    };

    memberPeerConn.setRemoteDescription(new RTCSessionDescription(sdp), function() { 
      memberPeerConn.createAnswer(function(desc) {
        memberPeerConn.setLocalDescription(desc, function() {
          self._ws.send(fwdMsg(id, 'sdpAnswer', {'from': self.id,'sdp': desc}));
        });
      });
    });

    memberPeerConn.ondatachannel = function(event) {
      var datachannel = event.channel;

      datachannel.onopen = function(event) {
        self._members[id].datachannel = datachannel;
        if (self._eventCbs.hasOwnProperty(self._connectEvtName)) 
          self._eventCbs[self._connectEvtName].call(null, id);
      };

      datachannel.onmessage = function(event) {
        self._handleP2PMsg(event);
      };
    };
  };

  Playrtc.prototype._handleP2PMsg = function(event) {
    var self = this;
    var json = JSON.parse(event.data);
    if (self.p2p._msgCbs.hasOwnProperty(json.kind)) {
      self.p2p._msgCbs[json.kind].call(null, json.from, json.data);
    } else {
      console.error('Received unknow P2P msg kind: ' + json.kind);
    }
  };

  Playrtc.prototype._triggerReady = function() {
    var self = this;
    if (!self.ready) {
      self.ready = true;
      self._ws.send(adminMsg('ready', null));
      if (self._eventCbs.hasOwnProperty(self._readyEvtName)) 
        self._eventCbs[self._readyEvtName].call(null);
    }
  };

  Playrtc.prototype._isReady = function() {
    var self = this;
    var ready = true;
    self._initialMembers.forEach(function (initMemberId) {
      if (self._members.hasOwnProperty(initMemberId) && self._members[initMemberId].datachannel === null) {
        ready = false;
      }
    });
    return ready;
  };

  return playrtc;
});
