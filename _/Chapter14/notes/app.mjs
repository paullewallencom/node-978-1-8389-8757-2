import { default as express } from 'express';
import { default as hbs } from 'hbs';
import * as path from 'path';
// import * as favicon from'serve-favicon';
import { default as logger } from 'morgan';
import { default as rfs } from 'rotating-file-stream';
import { default as DBG } from 'debug';
const debug = DBG('notes:debug'); 
const dbgerror = DBG('notes:error');
import { default as cookieParser } from 'cookie-parser';
import { default as bodyParser } from 'body-parser';
import helmet from 'helmet';
import csrf from 'csurf';
import * as http from 'http';
import { approotdir } from './approotdir.mjs';
const __dirname = approotdir;
import {
    normalizePort, onError, onListening, handle404, basicErrorHandler
} from './appsupport.mjs';

import dotenv from 'dotenv/config.js';

import { router as indexRouter } from './routes/index.mjs';
import { router as notesRouter }  from './routes/notes.mjs';
import { router as usersRouter, initPassport } from './routes/users.mjs';

import socketio from 'socket.io';
import passportSocketIo from 'passport.socketio'; 

import session from 'express-session';
import sessionFileStore from 'session-file-store';
import ConnectRedis from 'connect-redis';
import redis from 'redis';
var sessionStore;
if (typeof process.env.REDIS_ENDPOINT !== 'undefined'
 && process.env.REDIS_ENDPOINT !== '') {
    const RedisStore = ConnectRedis(session);
    const redisClient = redis.createClient({
        host: process.env.REDIS_ENDPOINT
    });
    sessionStore = new RedisStore({ client: redisClient });
} else {
    const FileStore = sessionFileStore(session);
    sessionStore = new FileStore({ path: "sessions" });
}

export const sessionCookieName = 'notescookie.sid';
const sessionSecret = 'keyboard mouse'; 

import { useModel as useNotesModel } from './models/notes-store.mjs';
import { init as homeInit } from './routes/index.mjs';
import { init as notesInit } from './routes/notes.mjs';
useNotesModel(process.env.NOTES_MODEL ? process.env.NOTES_MODEL : "memory")
.then(store => {
    debug(`Using NotesStore ${store}`);
    homeInit();
    notesInit();
})
.catch(error => { onError({ code: 'ENOTESSTORE', error }); });

export const app = express();

export const port = normalizePort(process.env.PORT || '3000');
app.set('port', port);

export const server = http.createServer(app);

server.listen(port);
server.on('request', (req, res) => {
    debug(`${new Date().toISOString()} request ${req.method} ${req.url}`);
});
server.on('error', onError);
server.on('listening', onListening);

export const io = socketio(server);

io.use(passportSocketIo.authorize({
    cookieParser: cookieParser,
    key:          sessionCookieName,
    secret:       sessionSecret,
    store:        sessionStore
}));

import redisIO from 'socket.io-redis';
if (typeof process.env.REDIS_ENDPOINT !== 'undefined'
 && process.env.REDIS_ENDPOINT !== '') {
    io.adapter(redisIO({ host: process.env.REDIS_ENDPOINT, port: 6379 }));
}

// TODO is success and fail callbacks required or useful?  These are marked optional.

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
hbs.registerPartials(path.join(__dirname, 'partials'));

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

app.use(logger(process.env.REQUEST_LOG_FORMAT || 'dev', {
    // immediate: true,
    stream: process.env.REQUEST_LOG_FILE ?
        rfs.createStream(process.env.REQUEST_LOG_FILE, {
            size:     '10M', // rotate every 10 MegaBytes written
            interval: '1d',  // rotate daily
            compress: 'gzip' // compress rotated files
        })
        : process.stdout
}));
const csp_connect_src = [ "'self'" ];
if (typeof process.env.CSP_CONNECT_SRC_URL === 'string'
  && process.env.CSP_CONNECT_SRC_URL !== '') {
    csp_connect_src.push(process.env.CSP_CONNECT_SRC_URL);
}
app.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'" ],
      styleSrc: ["'self'", 'fonts.googleapis.com' ],
      fontSrc: ["'self'", 'fonts.gstatic.com' ],
      connectSrc: csp_connect_src
    }
}));
app.use(helmet.dnsPrefetchControl({ allow: false }));
app.use(helmet.featurePolicy({
    features: {
        accelerometer: ["'none'"],
        ambientLightSensor: ["'none'"],
        autoplay: ["'none'"],
        camera: ["'none'"],
        documentDomain: ["'self'"],
        documentWrite: ["'self'"],
        encryptedMedia: ["'self'"],
        fullscreen: ["'self'"],
        geolocation: ["'none'"],
        gyroscope: ["'none'"],
        vibrate: ["'none'"],
        payment: ["'none'"],
        syncXhr: ["'none'"]
    }
}));
app.use(helmet.frameguard({ action: 'deny' }));
app.use(helmet.xssFilter());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrf({ cookie: true }));
// app.use(sqlinjection);
app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: true,
    saveUninitialized: true,
    name: sessionCookieName,
    secure: true,
    maxAge: 2 * 60 * 60 * 1000 // 2 hours
}));
initPassport(app);
app.use(express.static(path.join(__dirname, 'public')));
// app.use('/assets/vendor/bootstrap', express.static(
//     path.join(__dirname, 'node_modules', 'bootstrap', 'dist')));
// app.use('/assets/vendor/bootstrap', express.static(
//     path.join(__dirname, 'theme', 'dist')));
app.use('/assets/vendor/bootstrap/js', express.static(
    path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js')));
app.use('/assets/vendor/bootstrap/css', express.static(
    path.join(__dirname, 'minty')));
app.use('/assets/vendor/jquery', express.static(
    path.join(__dirname, 'node_modules', 'jquery', 'dist')));
app.use('/assets/vendor/popper.js', express.static(
    path.join(__dirname, 'node_modules', 'popper.js', 'dist', 'umd')));
app.use('/assets/vendor/feather-icons', express.static(
    path.join(__dirname, 'node_modules', 'feather-icons', 'dist')));

// Router function lists
app.use('/', indexRouter);
app.use('/notes', notesRouter);
app.use('/users', usersRouter);

// error handlers
// catch 404 and forward to error handler
app.use(handle404);
app.use(basicErrorHandler);

/*
TODO - need a close function to shut this down 

OR - the server object is exported, perhaps there is a close function ?

REASON - test/test-model loads routes/notes that in turn loads functions from this module.  By loading this module, the code is run, and the server launches.  Therefore we had to modify it to support running standalone.

*/