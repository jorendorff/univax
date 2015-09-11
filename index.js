// Univax: how not to implement collaborative text editing for the Web

// This is a typical Node server. Plug together a few blocks and you've got an
// HTTP server.
var app = require('express')();
var server = require('http').Server(app);

// Add socket.io for fast communication between browser and server.
var io = require('socket.io')(server);

// The server only knows how to send a single page, index.html.  (It's not
// *quite* that simple really. Attaching socket.io to the server, above, adds
// more functionality to the server. It can now serve 'socket.io/socket.io.js',
// the browser-side half of socket.io.)
app.get('/', function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

// The model. These three variables make up the complete state of the editor.
// Every client has its own copy of the first two. That's what shows up on the
// screen. But each client's copy is just a clone. Changes are always made here
// on the server first, then broadcast to all clients.
var text = "";       // Full text of the document.
var cursors = {};    // Maps user ids to integer offsets within the document.
var nextUserId = 0;  // Used to generate a unique id for each user.

// Now a function to compute movement within the document. We'll use this when
// a user hits an arrow key.
//
// This is where the cost of having a single string instead of an array of
// lines becomes obvious -- but don't rush to change it: an array of lines
// would have its own problems!
function computeMove(text, offset, dir) {
  // Return the offset of the first character in the line of `text` that
  // contains the given `offset`. So if `offset` is already at the beginning
  // of a line, this returns it unchanged.
  function lineStart(offset) {
    while (offset > 0 && text[offset - 1] !== '\n')
      offset--;
    return offset;
  }

  // Return the offset of the end of the line that contains `offset`.
  // The result will point to a newline or else the end of the document.
  function lineEnd(offset) {
    while (offset < text.length && text[offset] !== '\n')
      offset++;
    return offset;
  }

  // Return the offset of the line after the one containing `text[offset]`,
  // or undefined if there is no next line.
  function nextLineStart(offset) {
    for (; offset < text.length; offset++) {
      if (text[offset] === '\n')
        return offset + 1;
    }
    return undefined; // hit end of document: no more lines
  }

  switch (dir) {
    case "left":
      if (offset === 0)
        return undefined;  // already at top left corner; nowhere to go

      // Unicode bug: Just subtracting 1 here is simple but wildly incorrect.
      // If we allowed non-BMP characters (surrogate pairs) in the document,
      // moving by 1 could put you in between the two halves of a single
      // character. Same thing if you're trying to move past a character with a
      // combining accent. If you're editing Hebrew or Arabic text, pressing
      // the left arrow key will move the cursor right. PRs welcome!
      return offset - 1;

    case "right":
      if (offset === text.length)
        return undefined;  // already at end of document; nowhere to go
      return offset + 1;  // Unicode bug: See above.

    case "home": {
      var start = lineStart(offset);
      return start === offset ? undefined : start;
    }

    case "end": {
      var end = lineEnd(offset);
      return end === offset ? undefined : end;
    }

    case "up": {
      var l1 = lineStart(offset);
      if (l1 === 0)
        return undefined;  // already on the first line; nowhere to go
      var goalColumn = offset - l1;
      var l0 = lineStart(l1 - 1);
      return Math.min(l0 + goalColumn, l1 - 1);
    }

    case "down": {
      var goalColumn = offset - lineStart(offset);
      var l1 = nextLineStart(offset);
      if (l1 === undefined)
        return undefined; // already on the last line; nowhere to go
      return Math.min(l1 + goalColumn, lineEnd(l1));
    }

    default:
      throw new TypeError("unrecognized move code");
  }
}

// This array can be used to validate a direction before calling computeMove().
var directions = ["left", "right", "home", "end", "up", "down"];

// Return true if the given character is allowed in the document. This is of
// course a balancing act between security and letting Unicode do its job.  We
// are super permissive. If you're reading this to find some clever path
// through this code, to wreck the document: don't bother. It's too easy!
function isPermittedCharacter(ch) {
  // Since socket.io lets a client send just about anything, check that ch is
  // at least the right type.
  if (typeof ch !== "string")
    return false;

  // Users must type one character at a time. Unfortunately this means we're
  // banning all characters outside the BMP - but that is necessary since other
  // parts of the code do not support keeping surrogates paired at all times.
  // Fix computeMove() first if you want to fix this.
  if (ch.length !== 1)
    return false;

  // Ban a few ASCII control characters, like '\r' and '\b'.
  var c = ch.charCodeAt(0);
  if (c < 9 || (c >= 11 && c <= 31) || c === 127)
    return false;

  // Ban unpaired surrogate code points.
  if (c >= 0xD800 && c <= 0xDFFF)
    return false;

  // Ban a few Unicode control characters, including Bidi control characters.
  if ((c >= 0x2028 && c <= 0x202F) || (c >= 0x2066 && c <= 0x206F))
    return false;

  // Otherwise, allow it.
  return true;
}

// Now all we have to do is handle socket.io connections so people can interact
// with the document. For example, every time a user connects:
io.on('connection', function (socket) {
  // Assign this user a unique id.
  var userId = nextUserId++;

  // When this user types a character...
  socket.on('type', ch => {
    // ...after some basic input validation...
    if (!isPermittedCharacter(ch))
      return;
    console.log("User " + userId + " typed character `" + ch + "`");

    // ...put it in the document...
    var offset = cursors[userId];
    text = text.slice(0, offset) + ch + text.slice(offset, text.length);

    // ...and advance all other users' cursors. (There are many neat puzzles in
    // the next few lines of code, starting with: Why do we need to do this in
    // the first place?)
    for (var u in cursors) {
      u = Number(u);  // because property keys are strings, bleah JavaScript
      if (cursors[u] > offset || u === userId)
        cursors[u] += ch.length;
    }

    // Notify everyone (including this user!) that a character was typed. Even
    // the user who hit the key doesn't see the character until their browser
    // receives this message.
    io.emit('typed', {ch: ch, offset: offset, user: userId});
  });

  // When the user hits an arrow key...
  socket.on('move', dir => {
    // ...after some basic input validation...
    if (directions.indexOf(dir) === -1)
      return;

    // ...figure out if the move is actually possible, and if so, where we're
    // moving to...
    var newOffset = computeMove(text, cursors[userId], dir);
    if (newOffset !== undefined) {
      // ...then update the model and notify all clients.
      cursors[userId] = newOffset;
      io.emit('moved', {user: userId, offset: newOffset});
    }
  });

  // When the user hits backspace or delete...
  socket.on('delete', dir => {
    // ...after some basic input validation...
    if (directions.indexOf(dir) === -1)
      return;

    // ... first figure out if deleting in that direction is possible...
    var here = cursors[userId];
    var there = computeMove(text, here, dir);

    // ...and if so, update the model and notify all clients.
    if (there !== undefined) {
      var start = Math.min(here, there);
      var stop = Math.max(here, there);
      var len = stop - start;  // should always be 1, for now!

      text = text.slice(0, start) + text.slice(stop, text.length);
      for (var u in cursors) {
        u = Number(u);
        var pos = cursors[u];
        if (pos > start)
          cursors[u] = (pos > stop ? pos - len : start);
      }
      io.emit('deleted', {start: start, stop: stop});
    }
  });

  // When this user disconnects, delete their cursor.
  socket.on('disconnect', () => {
    delete cursors[userId];

    // Also make the cursor disappear from everyone's screen.
    io.emit('disconnected', userId);
  });

  // OK. Since this user just connected, send them the current state.
  socket.emit('welcome', {
    id: userId,
    document: text,
    cursors: cursors
  });

  // Add this user's cursor and announce their entry to everyone.
  cursors[userId] = 0;  // start at the top of the file
  io.emit('connected', userId);
});

// Actually start the server. Enjoy!
var port = Number(process.env.PORT) || 3001;
server.listen(port, function () {
  console.log('listening on *:' + port);
});
