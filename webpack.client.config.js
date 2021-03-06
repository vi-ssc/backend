require('dotenv').config()
const path = require('path')
const { ModuleFederationPlugin } = require('webpack').container
const nodeExternals = require('webpack-node-externals')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
const fetchRemotes = require('./webpack/fetch-remotes')
const remoteEntries = require('./webpack/remote-entries')
const port = process.env.PORT || 80
const sslPort = process.env.SSL_PORT || 443
const sslEnabled = /true/i.test(process.env.SSL_ENABLED)
const publicPort = sslEnabled ? sslPort : port
const chalk = require('chalk')

const server = env => {
  console.log(env)
  if (env.serverless) {
    remoteEntries.forEach(e => (e.path = 'webpack'))
    console.log(chalk.yellow('serverless build'))
  }
  return new Promise(resolve => {
    fetchRemotes(remoteEntries).then(remotes => {
      console.info(remotes)
      resolve({
        externals: [nodeExternals()],
        target: 'async-node',
        mode: 'development',
        devtool: 'source-map',
        entry: ['@babel/polyfill', path.resolve(__dirname, 'src/server.js')],
        output: {
          publicPath: `http://localhost:${publicPort}`,
          path: path.resolve(__dirname, 'dist'),
          libraryTarget: 'commonjs'
        },
        resolve: {
          extensions: ['.js']
        },
        module: {
          rules: [
            {
              test: /\.js?$/,
              exclude: /node_modules/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: ['@babel/preset-env']
                }
              }
            }
          ]
        },
        plugins: [
          new ModuleFederationPlugin({
            name: 'Aegis',
            filename: 'remoteEntry.js',
            library: {
              name: 'Aegis',
              type: 'commonjs-module'
            },
            remoteType: 'commonjs-module',
            remotes,
            exposes: {
              './server': './src/server',
              './domain': '@module-federation/aegis/lib/domain',
              './remoteEntries': './webpack/remote-entries'
            }
          })
        ]
      })
    })
  })
}

const client = env => {
  console.log(env)
  if (env.serverless) {
    remoteEntries.forEach(e => (e.path = 'webpack'))
    console.log(chalk.yellow('serverless build'))
  }
  return new Promise(resolve => {
    fetchRemotes(remoteEntries).then(remotes => {
      console.info(remotes)
      resolve({
        target: 'web',
        mode: 'development',
        devtool: 'source-map',
        entry: [path.resolve(__dirname, 'src/server.js')],
        output: {
          publicPath: `http://localhost:${publicPort}`,
          path: path.resolve(__dirname, 'dist'),
          libraryTarget: 'commonjs'
        },
        resolve: {
          extensions: ['.js']
        },
        module: {
          rules: [
            {
              test: /\.js?$/,
              exclude: /node_modules/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: ['@babel/preset-env']
                }
              }
            }
          ]
        },
        plugins: [
          new NodePolyfillPlugin(),
          new ModuleFederationPlugin({
            name: 'Aegis',
            filename: 'remoteEntry.js',
            library: {
              name: 'Aegis',
              type: 'commonjs-module'
            },
            remoteType: 'commonjs-module',
            remotes,
            exposes: {
              './server': './src/server',
              './domain': '@module-federation/aegis/lib/domain',
              './remoteEntries': './webpack/remote-entries'
            }
          })
        ]
      })
    })
  })
}

module.exports = [server]
