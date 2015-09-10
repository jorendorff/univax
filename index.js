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

// Now all we have to do is handle socket.io connections so people can interact
// with the document. For example, every time a user connects:
io.on('connection', function (socket) {
  // Assign this user a unique id.
  var userId = nextUserId++;

  // When this user types a character...
  socket.on('typed', ch => {
    console.log("User " + userId + " typed character `" + ch + "`");

    // ...go ahead and put it in the document...
    var offset = cursors[userId];
    text = text.slice(0, offset) + ch + text.slice(offset, text.length);

    // ...and advance all other users' cursors. (Puzzle over this code!)
    for (var u in cursors) {
      u = Number(u);  // because property keys are strings, bleah JavaScript
      if (cursors[u] > offset || u === userId)
        cursors[u]++;
    }

    // Notify everyone (including this user!) that a character was typed. Even
    // the user who hit the key doesn't see the character until their browser
    // receives this message.
    io.emit('insert', {ch: ch, offset: offset, user: userId});
  });

  // When this user disconnects, delete their cursor.
  socket.on('disconnect', () => {
    delete cursors[userId];

    // Also make the cursor disappear from everyone's screen.
    io.emit('user.exit', userId);
  });

  // OK. Since this user just connected, send them the current state.
  socket.emit('update', {
    id: userId,
    document: text, 
    cursors: cursors
  });

  // Add this user's cursor and announce their entry to everyone.
  cursors[userId] = 0;  // start at the top of the file
  io.emit('user.enter', userId);
});

// Actually start the server. Enjoy!
var port = Number(process.env.PORT) || 3001;
server.listen(port, function () {
  console.log('listening on *:' + port);
});
