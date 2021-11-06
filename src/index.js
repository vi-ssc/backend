/**
 * Handle options and start the service.
 * Options:
 *
 * - run as serverless function or as web server
 * - http or https
 * - authorized routes enabled or disabled (json web token)
 * - clustering enabled or disabled
 * - hot reload as rolling restart or module cache refresh
 */

'use strict'

require('dotenv').config()
require('regenerator-runtime')
const importFresh = require('import-fresh')

const { adapters, services } = require('../../aegis/lib')

const {
  AuthorizationService,
  CertificateService,
  ClusterService,
  MeshService
} = services

const { ServerlessAdapter } = adapters

const fs = require('fs')
const tls = require('tls')
const http = require('http')
const https = require('https')
const proxy = require('express-http-proxy')
const express = require('express')
const websocket = require('ws')

//const StaticFileHandler = require('serverless-aws-static-file-handler')

const port = process.argv[2] ? process.argv[2] : process.env.PORT || 80
const sslPort = process.argv[2] ? process.argv[2] : process.env.SSL_PORT || 443
const apiRoot = process.env.API_ROOT || '/microlib/api'
const keyFile = 'cert/privatekey.pem'
const certFile = 'cert/certificate.pem'
const proxyMode = /true/i.test(process.env.PROXYMODE) || false
const forceTimeout = 3000 // time to wait for conn to drop before closing server
const certLoadPath = process.env.CERTLOAD_PATH || '/microlib/load-cert'
const hotReloadPath = process.env.HOTRELOAD_PATH || '/microlib/reload'
const cloudProvider = process.env.CLOUDPROVIDER || 'aws'
const clusterEnabled = /true/i.test(process.env.CLUSTER_ENABLED)
const checkPublicIpUrl =
  process.env.IPCHECK_URL || 'https://checkip.amazonaws.com'
const domain = process.env.DOMAIN || 'federated-microservices.org'
const domainEmail = process.env.DOMAIN_EMAIL
const sslEnabled = // required in production
  /prod/i.test(process.env.NODE_ENV) || /true/i.test(process.env.SSL_ENABLED)

// enable authorization if selected
const app = AuthorizationService.protectRoutes(express(), '/microlib')

function isServerless () {
  return (
    /true/i.test(process.env.SERVERLESS) || /serverless/i.test(process.title)
  )
}

/**
 * Callbacks attached to existing routes are stale.
 * Clear the routes whose controllers we need to update.
 */
function clearRoutes () {
  app._router.stack = app._router.stack.filter(
    k => !(k && k.route && k.route.path && k.route.path.startsWith(apiRoot))
  )
}

/**
 * Load federated server module. Call `clear` to delete non-webpack cache if
 * hot reloading. Call `start` to import remote models, adapters, services,
 * set API routes and load persisted data from storage.
 *
 * Note:
 *
 * About hot reload cache purge: even though we will have just loaded a fresh
 * copy of remoteEntry.js, because the runtime only loads each module once and
 * subsequent imports don't bypass the cache, they  won't be fresh and will need
 * to be purged. We do not cache remoteEntry.js itself, so the old copy won't be
 * purged, but it will eventually be garbage collected since nothing will point
 * to it anymore after reload.
 *
 * @param {{hot:boolean, serverless:boolean}} options If `hot` is true, reload;
 * if this is a serverless function call, set `serverless` to true.
 */
async function startMicroLib ({ hot = false, serverless = false } = {}) {
  const remoteEntry = importFresh('./remoteEntry') // do not cache
  const factory = await remoteEntry.microlib.get('./server')
  const serverModule = factory()
  if (hot) {
    // clear stale routes
    clearRoutes()
    // clear cache on hot reload: even though we just loaded a fresh
    // copy, because the runtime only loads a library once, and its
    // dependencies dont bypass the cache, they are not fresh and
    // need to be purged
    serverModule.default.clear()
  }
  await serverModule.default.start(app, serverless)
  // `invoke` calls the server's controllers directly
  return serverModule.default.invoke
}

/**
 * Handle hot reload request. If running in cluster mode,
 * do a rolling restart instead of memory purge.
 */
function reloadCallback () {
  // Manual reset if left in wrong state
  app.use(`${hotReloadPath}-reset`, function (_req, res) {
    process.send({ cmd: 'reload-reset' })
    res.send('reload status reset...try again')
  })

  if (clusterEnabled) {
    app.use(hotReloadPath, async function (_req, res) {
      res.send('<h1>starting cluster reload</h1>')
      process.send({ cmd: 'reload' })
    })
    return
  }

  app.use(hotReloadPath, async function (_req, res) {
    try {
      // restart microlib
      await startMicroLib({ hot: true })
      res.send('<h1>hot reload complete</h1>')
    } catch (error) {
      console.error(error)
    }
  })
}

/**
 *
 */
function checkPublicIpAddress () {
  const bytes = []
  const proto = sslEnabled ? 'https' : 'http'
  const prt = sslEnabled ? sslPort : port

  if (/local/i.test(process.env.NODE_ENV)) {
    const ipAddr = 'localhost'
    console.log(`\n 🌎 ÆGIS listening on ${proto}://${ipAddr}:${prt} \n`)
    return
  }
  http.get(
    {
      hostname: checkPublicIpUrl,
      method: 'get'
    },
    response => {
      response.on('data', chunk => bytes.push(chunk))
      response.on('end', function () {
        const ipAddr = bytes.join('').trim()
        console.log(`\n 🌎 ÆGIS listening on ${proto}://${ipAddr}:${prt} \n`)
      })
    }
  )
}

/**
 * Attach {@link MeshService} to the API listener socket.
 * Listen for upgrade events from http server and switch
 * to WebSockets protocol. Clients connecting this way are
 * using the service mesh, not the REST API.
 *
 * @param {https.Server|http.Server} server
 */
function attachServiceMesh (server) {
  const wss = new websocket.Server({
    clientTracking: true,
    server: server,
    maxPayload: 104857600
  })
  wss.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, function (ws) {
      wss.emit('connection', ws, request)
    })
  })
  MeshService.attachServer(wss)
}

let certAuthChallenge = false

/**
 * Shutdown gracefully. Return 503 during shutdown to prevent new connections
 * @param {*} server
 * @param {*} [options ]
 * @returns
 */
function shutdown (server) {
  let shuttingDown = false
  const devTimeout = 3000

  // Graceful shutdown taken from: http://blog.argteam.com/
  process.on('SIGTERM', () => {
    // shorter timeout in dev
    const timeout = !/^prod.*/i.test(process.env.NODE_ENV)
      ? devTimeout
      : forceTimeout

    if (shuttingDown) return
    shuttingDown = true
    console.info('Received kill signal (SIGTERM), shutting down')

    setTimeout(function () {
      console.error(
        'Taking too long to close connections, forcefully shutting down'
      )
      process.exit(1)
    }, timeout).unref()

    server.close(function () {
      console.info('Closed out remaining connections.')
      process.exit()
    })
  })

  function middleware (req, res, next) {
    if (!shuttingDown) return next()
    res.set('Connection', 'close')
    res.status(503).send('Server is in the process of restarting.')
  }

  return middleware
}

/**
 * Programmatically provision CA cert using RFC
 * https://datatracker.ietf.org/doc/html/rfc8555
 *
 * {@link CertificateService} kicks off automated
 * id challenge test, conducted by the issuing CA.
 * If test passes or if cert already exists, hand
 * back the cert and private key.
 *
 * @param {*} domain
 * @param {*} domainEmail
 * @returns
 */
async function getTrustedCert (domain, domainEmail, renewal = false) {
  if (!renewal && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return {
      key: fs.readFileSync(keyFile, 'utf8'),
      cert: fs.readFileSync(certFile, 'utf-8')
    }
  }
  // tell http server not to redirect
  certAuthChallenge = true

  const { key, cert } = await CertificateService.provisionCert(
    domain,
    domainEmail
  )

  fs.writeFileSync(certFile, cert, 'utf-8')
  fs.writeFileSync(keyFile, key, 'utf-8')

  // http server can redirect now
  certAuthChallenge = false

  return {
    key,
    cert
  }
}

/**
 * Using {@link tls.createSecureContext} to create/renew
 * certs without restarting the server
 *
 * @param {boolean} renewal
 * @returns
 */
async function createSecureContext (renewal = false) {
  const cert = await getTrustedCert(domain, domainEmail, renewal)
  return tls.createSecureContext(cert)
}

/**
 * Listen on unsecured port (80). Redirect
 * to secure port (443) if SSL is enabled.
 */
function startHttpServer () {
  // always run unsecured port
  const httpServer = http.createServer(app)
  // Use graceful shutdown middleware
  app.use(shutdown(httpServer))
  if (sslEnabled) {
    // set route that redirects http to https
    httpServer.use('*', function (req, res) {
      // Facilitate cert challenge - no redirect yet
      if (!certAuthChallenge) {
        res.redirect('https://' + req.headers.host + req.url)
      }
    })
  } else {
    attachServiceMesh(httpServer)
  }
  httpServer.listen(port, checkPublicIpAddress)
}

/** the current cert/key pair */
let secureCtx

/**
 * Start the web server. Programmatically
 * provision CA cert if SSL (TLS) is enabled
 * and no cert is found in /cert directory.
 */
async function startWebServer () {
  startHttpServer()

  if (sslEnabled) {
    secureCtx = await createSecureContext()
    // renew certs without restarting the server
    const httpsServer = https.createServer(
      {
        SNICallback: (_, cb) => cb(null, secureCtx)
      },
      app
    )
    // update secureCtx to refresh certificate
    app.use(
      certLoadPath,
      async () => (secureCtx = await createSecureContext(true))
    )
    // graceful shutdown prevents new clients from connecting & waits
    // up to `shutdownOptions.forceTimeout` for them to disconnect
    app.use(shutdown(httpsServer))
    // service mesh uses same port
    attachServiceMesh(httpsServer)
    // callback figures out public-facing addr
    httpsServer.listen(sslPort, checkPublicIpAddress)
  }

  fs.writeFileSync(`${process.title}.pid`, `${process.pid}\n`, 'utf-8')
}

/**
 * start microlib and the webserver
 *
 * this function isn't called if running in serverless mode
 */
async function startService () {
  try {
    app.use(express.json())
    app.use(express.static('public'))
    await startMicroLib()
    reloadCallback()
    startWebServer()
  } catch (e) {
    console.error(e)
  }
}

if (!isServerless()) {
  if (proxyMode) {
    app.use('/', proxy(process.argv[2]))
    app.listen(process.argv[3])
  } else if (clusterEnabled) {
    // Fork child processes (one per core)
    // children share socket descriptor (round-robin)
    ClusterService.startCluster(startService)
  } else {
    startService()
  }
}

let serverlessAdapter

/**
 * Serverless function - entry point called by serverless platform.
 * @param  {...any} args - payload passed to serverless function
 */
exports.handleServerlessRequest = async function (...args) {
  console.info('serverless function called', args)
  if (!serverlessAdapter) {
    serverlessAdapter = await ServerlessAdapter(
      () => startMicroLib({ serverless: true }),
      cloudProvider
    )
  }
  serverlessAdapter.invokeController(...args)
}

// const fileHandler = new StaticFileHandler('public')

/**
 * Serve static files, i.e. the demo app.
 * @param {*} event
 * @param {*} context
 * @returns
 */
// exports.serveHtml = async (event, context) => {
//   console.debug({ event, context })
//   console.log(event.path)
//   event.path = 'index.html'
//   return fileHandler.get(event, context)
// }
