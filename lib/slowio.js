// slowio.js - Proxies for socket.io sockets, to add artificial latency.

function SlowSocket(socket) {
  this._socket = socket;
  this._queue = [];
  this._tempoRubato = 0;
}

SlowSocket.prototype = {
  constructor: SlowSocket,

  // Schedule a function to be called later.
  _delay: function (f) {
    this._queue.push(f);
    setTimeout(() => this._deliver(), Math.random() * slowio.maxLatency);
  },

  // Second half of the implementation of _delay(): deliver some messages.
  _deliver: function () {
    // Heuristic hacks. There's no one right answer we're shooting for; the
    // goal is just to make the network behavior unbearably bad, in a way that
    // has the awful ring of truth, something that hits you in the gut. So:
    // allow traffic to queue up, and deliver it in random bursts.
    this._tempoRubato++;
    if (this._tempoRubato == this._queue.length ||
        Math.random() > Math.pow(1/2, 1 / slowio.burstiness)) {
      while (this._tempoRubato > 0) {
        // Schedule each event handler separately, to allow for errors.
        setTimeout(() => this._queue.shift()(), 0);
        this._tempoRubato--;
      }
    }
  },

  // socket.on(): just like the socket.io method, but slower
  on: function (name, handler) {
    var self = this;
    this._socket.on(name,
                    (name === "connection")
                    ? socket => {
                      // A new connection! Slow it down, too.
                      this._delay(() => handler(slowio.addLatency(socket)));
                    }
                    : function () {
                      self._delay(() => handler.apply(undefined, arguments));
                    });
  },

  // socket.emit(): just like the socket.io method, but slower
  emit: function () {
    var args = arguments;
    this._delay(() => this._socket.emit.apply(this._socket, args));
  }
};

var slowio = {
  burstiness: 12,    // median number of messages per burst, in sufficiently heavy traffic
  maxLatency: 0,     // milliseconds

  // Given a socket.io Server or Socket object `io`, return an object with
  // `.on()` and `.emit()` methods that eventually forward messages to/from
  // `io`, but with a delay of up to `slowio.maxLatency` msec.
  addLatency: function (io) {
    return new SlowSocket(io);
  }
};

module.exports = slowio;
