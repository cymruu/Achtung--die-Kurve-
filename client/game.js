/* debugging */
function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

/* game engine */
function GameEngine(container) {
	debugLog("creating game");

	// game variables
	this.players = [];
	this.idToPlayer = []; // maps playerId to index of this.players
	this.gameStartTimestamp = null;
	this.lastUpdateTimestamp = null;
	this.gameOver = true;

	// game properties
	this.velocity = null;
	this.turnSpeed = null;

	// connection state
	this.websocket = null;
	this.connected = false;
	this.bestSyncPing = 9999;
	this.worstSyncPing = 0;
	this.syncTries = 0;
	this.serverTimeDifference = 0;
	this.ping = 0;

	// canvas related
	this.container = container; // DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments	
}

GameEngine.prototype.connect = function(url, name) {
	if(typeof MozWebSocket != "undefined")
		this.websocket = new MozWebSocket(url, name);
	else
		this.websocket = new WebSocket(url, name);
	
	this.websocket.parent = this;
	var game = this;
	
	try {
		this.websocket.onopen = function() {
			debugLog('Connected to websocket server');
			game.connected = true;
			game.syncWithServer();
		}
		this.websocket.onmessage = function got_packet(msg) {
			if(ultraVerbose)
				debugLog('received data: ' + msg.data);

			try {
				var obj = JSON.parse(msg.data);
			}
			catch(ex) {
				debugLog('JSON parse exception!');
			}

			switch(obj.mode) {
				case 'acceptUser':
					game.players[0].playerId = obj.playerId;
					game.idToPlayer[obj.playerId] = 0;
					break;
				case 'joinedGame':
					debugLog('you joined a game.');
					break;
				case 'gameParameters':
					game.setParams(obj);
					debugLog('received game params.');
					break;				
				case 'newPlayer':
					var newPlayer = new Player(playerColors[game.players.length]);
					newPlayer.playerId = obj.playerId;
					newPlayer.playerName = obj.playerName;
					game.addPlayer(newPlayer);
					debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
					break;
				case 'startGame':
					game.start(obj.startPositions, obj.startTime);
					break;
				case 'newInput':
					game.players[game.idToPlayer[obj.playerId]].turn(obj);
					break;

				// TODO: handle case where player leaves before game start
				// its gonna be ugly.. restructure game.players and game.idToPlayer

				case 'playerDied':
				case 'playerLeft':
					game.players[game.idToPlayer[obj.playerId]].alive = false;
					debugLog(game.players[game.idToPlayer[obj.playerId]].playerName +
					 obj.mode.substr(5));
					break;
				case 'gameEnded':
					game.gameOver = true;
					debugLog('game ended. ' + obj.winnerId != -1 ?
					 game.players[game.idToPlayer[obj.winnerId]].playerName + ' won' : 'draw!');
					break;
				case 'time':
					game.handleSyncResponse(obj.time);
					break;
				default:
					debugLog('unknown mode!');
			}
		}
		this.websocket.onclose = function() {
			debugLog('Websocket connection closed!');
			game.connected = false;
		}
	} catch(exception) {
		debugLog('websocket exception! name = ' + exception.name + ", message = "
		 + exception.message);
	}
}

GameEngine.prototype.syncWithServer = function(){
	game.syncSendTime = Date.now();
	game.sendMsg('getTime', {});
}
GameEngine.prototype.handleSyncResponse = function(serverTime){
	var ping = (Date.now() - game.syncSendTime) / 2;
	if(ping < game.bestSyncPing){
		game.bestSyncPing = ping;
		game.serverTimeDifference = serverTime - Date.now() + ping;
	}
	if(ping > game.worstSyncPing){
		game.ping += game.worstSyncPing / (syncTries - 1);
		game.worstSyncPing = ping;
	}else
		game.ping += ping / (syncTries - 1);
	if(++game.syncTries < syncTries)
		window.setTimeout(game.syncWithServer, game.syncTries * 50);
	else
		debugLog('synced with server with a maximum error of ' + game.bestSyncPing + ' msec'
		+ ', and average ping of ' + game.ping + ' msec');
}
GameEngine.prototype.getServerTime = function(){
	return this.serverTimeDifference + Date.now();
}

/* initialises the game */ 
GameEngine.prototype.setParams = function(obj) {
	/* Create CanvasStack */
	this.container.style.margin = 0;
	this.container.style.padding = 0;
	this.container.style.width = obj.w + 'px';
	this.container.style.height = obj.h + 'px';

	/* Set game variables */
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;

	debugLog("this game is for " + obj.nmin + " to " + obj.nmax + " players");
}	

GameEngine.prototype.requestGame = function(minPlayers) {
	//var playerName = prompt('Enter your nickname');
	// for testing reasons, we will use constant name
	var playerName = "testPlayer" + Math.floor(Math.random() * 1000);

	if(typeof playerName != "string" || playerName.length < 1)
		return;

	this.players[0].playerName = playerName;
	this.sendMsg('requestGame', {'playerName': playerName, 'minPlayers': minPlayers, 'maxPlayers': 8});
}

GameEngine.prototype.sendMsg = function(mode, data) {
	// re-enabled!
	if(this.connected === false) {
		debugLog('tried to send msg, but no websocket connection');
		return;
	}

	data.mode = mode;

	var str = JSON.stringify(data);
	this.websocket.send(str);

	if(ultraVerbose)
		debugLog('sending data: ' + str);
}

GameEngine.prototype.draw = function(callback) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].draw();
}

GameEngine.prototype.update = function(deltaTime) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].update(deltaTime);
}

GameEngine.prototype.loop = function() {
	var now = Date.now();
	var deltaTime = now - this.lastUpdateTimestamp;

	this.update(deltaTime);
	this.draw();
	this.lastUpdateTimestamp = now;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;

	/* internet player */
	if(player.playerId != null)
		this.idToPlayer[player.playerId] = this.players.length;

	this.players.push(player);
	debugLog("adding player to game");
}

GameEngine.prototype.stop = function() {
	debugLog("game ended");
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = Date.now();// replace by startTime - this.getServerTime() - this.ping + Date.now();
	this.lastUpdateTimestamp = Date.now();
	this.gameOver = false;
	
	debugLog("starting game in " + (this.gameStartTimestamp - Date.now()));

	/* create canvas stack */
	this.canvasStack = new CanvasStack('canvasContainer', canvasBgcolor);

	/* draw on background context, since we never need to redraw anything 
	 * on this layer (only clear for new game) */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseContext = canvas.getContext('2d');
	this.baseContext.lineWidth = lineWidth;

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.idToPlayer[ startPositions[i].playerId ];
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle);
	}

	var that = this;

	(function gameLoop() {
		that.loop();

		if(that.gameOver)
			that.stop();
		else
			window.setTimeout(gameLoop, 1000 / 60);
			//requestAnimFrame(gameLoop, that.canvas);
	})();
}

// not sure if it works like this ;p
window.requestAnimFrame = (function() {
	return function(/* function */ callback, /* DOMElement */ element) {
		window.setTimeout(callback, 1000 / 60);
	};
})();

/* players */
function Player(color) {
	this.playerId = null;
	this.playerName = null;
	this.velocity = null; //pixels per sec
	this.turnSpeed = null;
	this.angle = 0; // radians
	this.x = 0;
	this.y = 0;
	this.lcx = 0; // last confirmed x
	this.lcy = 0;
	this.lca = 0; // last confirmed angle
	this.lct = 0; // game time of last confirmed location (in millisec)
	this.color = color;
	this.turn = 0; // -1 is turn left, 0 is straight, 1 is turn right
	this.undrawnPts = []; // list of undrawn points x1, y1, x2, y2, ...
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.alive = false;

	debugLog("creating player");
}

Player.prototype.turn = function(obj) {
	/* run simulation from lcx, lcy on the conclusive canvas from time 
	 * lct to timestamp in object */
	this.simulate(this.lcx, this.lcy, this.lca, this.turn,
	 obj.gameTime - this.lct, this.game.baseContext, obj.x, obj.y);

	/* here we sync with server */
	this.lcx = this.x = obj.x;
	this.lcy = this.y = obj.y;
	this.lca = this.angle = obj.angle;
	this.lct = obj.gameTime;
	this.turn = obj.turn;

	/* clear this players canvas and run simulation on this player's
	 * context from timestamp in object to NOW */
	this.context.clear(); // might not work -- must test
	this.simulate(this.lcx, this.lcy, this.lca, this.turn,
	 Date.now() - obj.gameTime, this.context, null, null);
}

Player.prototype.simulate = function(x, y, angle, turn, time, ctx, destX, destY) {
	ctx.strokeStyle = this.color;
	//ctx.beginPath();
	ctx.moveTo(x, y);

	if(destX != null)
		time -= simStep;

	while(time > 0) {
		var step = Math.min(simStep, time);
		x += this.velocity * step/ 1000 * Math.cos(angle);
		y += this.velocity * step/ 1000 * Math.sin(angle);
		angle += turn * this.turnSpeed * step/ 1000;
		
		ctx.lineTo(x, y);

		time -= step;
	}

	if(destX != null)
		ctx.lineTo(destX, destY);

	//ctx.closePath();
	ctx.stroke();
}

Player.prototype.initialise = function(x, y, angle) {
	this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.undrawnSegs = [];
	this.alive = true;
	this.lcx = this.x = x;
	this.lcy = this.y = y;
	this.lct = 0;
	this.angle = angle;
	this.turn = 0;

	/* create canvas */
	var canvas = document.getElementById(this.game.canvasStack.createLayer());
	this.context = canvas.getContext('2d');
	this.context.lineWidth = lineWidth;
	this.context.strokeStyle = this.color;
	this.context.moveTo(x, y);

	debugLog("initialising player at (" + this.x + ", " + this.y + "), angle = " + this.angle);
}

Player.prototype.update = function(deltaTime) {
	if(!this.alive)
		return false;

	this.x += this.velocity * deltaTime/ 1000 * Math.cos(this.angle);
	this.y += this.velocity * deltaTime/ 1000 * Math.sin(this.angle);
	this.undrawnPts.push(this.x);
	this.undrawnPts.push(this.y);

	this.angle += this.turn * this.turnSpeed * deltaTime/ 1000;
}

Player.prototype.draw = function() {
	if(!this.alive)
		return;

	var len = this.undrawnPts.length/ 2;

	//this.context.beginPath();
	for(var i = 0; i < len; i++)
		this.context.lineTo(this.undrawnPts[i], this.undrawnPts[i + 1]);
	//this.context.closePath();
	this.context.stroke();

	this.undrawnPts = [];
}

/* input control */
function InputController(left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = null;
	this.game = null;

	debugLog("creating keylogger")
}

InputController.prototype.setPlayer = function(player) {
	this.player = player;
}

InputController.prototype.setGame = function(game) {
	this.game = game;
}

InputController.prototype.keyDown = function(keyCode) {
	if(!this.player.alive)
		return;

	if(keyCode == this.rightKeyCode && this.player.turn != -1) {
		this.player.turn = -1;
		this.game.sendMsg('newInput', {'turn': -1,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
	else if(keyCode == this.leftKeyCode && this.player.turn != 1){
		this.player.turn = 1;
		this.game.sendMsg('newInput', {'turn': 1,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
}

InputController.prototype.keyUp = function(keyCode) {
	if(!this.player.alive)
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) {
		this.player.turn = 0;
		this.game.sendMsg('newInput', {'turn': 0,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
}

/* create game */
window.onload = function() {

	/* some constants */
	var container = document.getElementById('canvasContainer');
	game = new GameEngine(container);
	var player = new Player(playerColors[0]);
	var inputControl = new InputController(keyCodeLeft, keyCodeRight);
	
	
	
	inputControl.setGame(game);
	game.addPlayer(player);
	inputControl.setPlayer(player);

	/* register key presses and releases */
	document.onkeydown = function(event) {
		var keyCode;

	 	if(event == null)
			keyCode = window.event.keyCode;
		else
			keyCode = event.keyCode;

		inputControl.keyDown(keyCode);
	}

	document.onkeyup = function(event) {
		var keyCode;

	 	if(event == null)
			keyCode = window.event.keyCode;
		else
			keyCode = event.keyCode;

		inputControl.keyUp(keyCode);
	}

	var startButton = document.getElementById('start1');
	startButton.addEventListener('click', function(){game.requestGame(1);}, false);
	startButton = document.getElementById('start2');
	startButton.addEventListener('click', function(){game.requestGame(2);}, false);
	startButton = document.getElementById('start3');
	startButton.addEventListener('click', function(){game.requestGame(3);}, false);
	game.connect(serverURL, "game-protocol");
}
