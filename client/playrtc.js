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
  if (typeof exports === 'object') {
     module.exports = definition();
  } else {
     window.Playrtc = definition();
  }
})(function() {
  'use strict';

  var BackboneEvents = window.BackboneEvents || require('backbone-events-standalone');

  var Playrtc = {};

  var DEFAULT_TURN_STUN_CONFIG = {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};
  var RTCPeerConnection = window.webkitRTCPeerConnection || window.mozRTCPeerConnection || window.RTCPeerConnection;
  var RTCSessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
  var RTCIceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;

  Playrtc.isCompatible = function() {
    if (navigator.mozGetUserMedia) {
      // console.warn('Firefox is not supported for now...');
      var firefoxDetectedVersion = parseInt(navigator.userAgent.match(/Firefox\/([0-9]+)\./)[1], 10);
      if (firefoxDetectedVersion < 27) {
        console.warn('Only Firefox >= 27 is supported (due to the use of SCTP-based datachannels and interop with Chrome)');
        return false;
      } else {
        return true;
      }
    } else if (navigator.webkitGetUserMedia){
      var webkitDetectedVersion = parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2], 10);
      if (webkitDetectedVersion < 31) {
        console.warn('Only Chrome >= 32 is supported (due to the use of SCTP-based datachannels and interop with Firefox)');
        return false;
      } else {
        return true;
      }
    } else {
      console.warn('Your browser is not supported...');
      return false;
    }
  };

  Playrtc.connect = function(url, config) {
    config = config || {};
    var webrtcConfig = config.webrtcConfig !== undefined ? config.webrtcConfig : DEFAULT_TURN_STUN_CONFIG;
    return new Io(url, webrtcConfig);
  };

  // Helper 
  function adminMsg(event, data) {
    return JSON.stringify({'adminEvent':event, 'data':data});
  }

  function usrMsg(event, data) {
    return JSON.stringify({'event':event, 'data':data});
  }

  function p2pUsrMsg(event, data) {
    return JSON.stringify({'event':event, 'data':data});
  }

  function fwdAdminMsg(to, event, data) {
    return JSON.stringify({'adminEvent': 'fwd', 'data': {'to':to, 'msg': {'adminEvent': event, 'data': data}}});
  }

  // Main object
  function Io(url, webrtcConfig) {
    var self = this;

    // public
    self.server = BackboneEvents.mixin({});
    self.p2p = BackboneEvents.mixin({});
    self.id = null; // will be init after
    self.webrtcConfig = webrtcConfig;
    self.ready = false;

    // private
    self._members = {}; // id -> {'peerconn': ..., 'datachannel': ...}
    self._initialMembers = [];
    self._ws = new WebSocket(url);

    self._ws.onmessage = function(evt) {
      var json = JSON.parse(evt.data);
      if (json.hasOwnProperty('event')) {
        // user event
        self.server.trigger(json.event, json.data);
      } else {
      // admin event
      var event = json.adminEvent;
      var data = json.data;

      if (event === 'initInfo') {
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

        else if (event === 'sdpOffer') {
          self._answerWebRtcHandshake(data.from, data.sdp);
        }

        else if (event === 'sdpAnswer') {
          self._members[data.from].peerconn.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }

        else if(event === 'iceCandidate') {
          if (self._members.hasOwnProperty(data.from)) {
            self._members[data.from].peerconn.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            console.error('ICE candidate sent before sdp-offer!');
          }
        }

        else if (event === 'disconnect') {
          if (self._members.hasOwnProperty(data.id)) {
            try {
              self._members[data.id].datachannel.close();
              self._members[data.id].peerconn.close();
            } catch(err) {}
            delete self._members[data.id];
            self.trigger('memberleft', data.id);
            if (self._isReady()) {
              self._triggerReady();
            }
          }
        }

      }
    };

    self.server.send = function(event, data) {
      self._ws.send(usrMsg(event, data));
    };

    self.p2p.send = function(to, event, data) {
      if (self._members.hasOwnProperty(to)) {
        self._members[to].datachannel.send(p2pUsrMsg(event, data));
      } else {
        console.warn('Tried to send ' + event + ' ' + JSON.stringify(data) + ' to a unknow member id: ' + to);
      }
    };    

    self.p2p.broadcast = function(event, data) {
      self.members.forEach(function(id) {
        self._members[id].datachannel.send(p2pUsrMsg(event, data));
      });
    };

  }

  BackboneEvents.mixin(Io.prototype);

  Object.defineProperty(Io.prototype, "members", {
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

  Io.prototype._initiateWebRtcHandshake = function(id) {
    var self = this;

    var memberPeerConn = new RTCPeerConnection(self.webrtcConfig, {optional: [{DtlsSrtpKeyAgreement: true}]});
    memberPeerConn.onicecandidate = function(iceEvt) {
      if (iceEvt.candidate) {
        self._ws.send(fwdAdminMsg(id, 'iceCandidate', {'from': self.id,'candidate': iceEvt.candidate}));
      }
    };

    self._members[id] = {'peerconn': memberPeerConn, 'datachannel': null};

    var datachannel = memberPeerConn.createDataChannel('playrtc', {reliable : true});

    datachannel.onopen = function(evt) {
      self._members[id].datachannel = datachannel;

      if (self._isReady()) {
        self._triggerReady();
      }
    };
    datachannel.onmessage = function(evt) {
      self._handleP2PMsg(evt, id);
    };
    
    memberPeerConn.createOffer(function(desc) {
      memberPeerConn.setLocalDescription(desc, function() {
        self._ws.send(fwdAdminMsg(id, 'sdpOffer', {'from':self.id, 'sdp': desc}));
      });
    }, function(err) {
      console.err("Error while creating WebRTC offer");
    });

  };

  Io.prototype._answerWebRtcHandshake = function(id, sdp) {
    var self = this;

    var memberPeerConn = new RTCPeerConnection(self.webrtcConfig, {optional: [{DtlsSrtpKeyAgreement: true}]});
    self._members[id] = {'peerconn': memberPeerConn, 'datachannel': null};

    memberPeerConn.onicecandidate = function(iceEvt) {
      if (iceEvt.candidate) {
        self._ws.send(fwdAdminMsg(id, 'iceCandidate', {'from': self.id,'candidate': iceEvt.candidate}));
      }
    };

    memberPeerConn.setRemoteDescription(new RTCSessionDescription(sdp), function() { 
      memberPeerConn.createAnswer(function(desc) {
        memberPeerConn.setLocalDescription(desc, function() {
          self._ws.send(fwdAdminMsg(id, 'sdpAnswer', {'from': self.id,'sdp': desc}));
        });
      }, function(err) {
        console.err("Error while creating WebRTC answer");
      });
    });

    memberPeerConn.ondatachannel = function(evt) {
      var datachannel = evt.channel;

      datachannel.onopen = function(evt) {
        self._members[id].datachannel = datachannel;
        self.trigger('newmember', id);
      };

      datachannel.onmessage = function(evt) {
        self._handleP2PMsg(evt, id);
      };
    };
  };

  Io.prototype._handleP2PMsg = function(evt, from) {
    var self = this;
    var json = JSON.parse(evt.data);
    self.p2p.trigger(json.event, from, json.data);
  };

  Io.prototype._triggerReady = function() {
    var self = this;
    if (!self.ready) {
      self.ready = true;
      self._ws.send(adminMsg('ready', null));
      self.trigger('ready');
    }
  };

  Io.prototype._isReady = function() {
    var self = this;
    var ready = true;
    self._initialMembers.forEach(function (initMemberId) {
      if (self._members.hasOwnProperty(initMemberId) && self._members[initMemberId].datachannel === null) {
        ready = false;
      }
    });
    return ready;
  };

  return Playrtc;
});
