const path = require('path');
const ContainerReferencePlugin = require('webpack').container.ContainerReferencePlugin;
// const ModuleFederationPlugin = require('webpack').container.ModuleFederationPlugin;
const nodeExternals = require('webpack-node-externals');
const fetchRemoteEntry = require('./webpack/fetch-remote-entry');
const remoteEntries = require('./webpack/remote-entries');
const sharedDependencies = require('./package.json').dependencies;

module.exports = () => {
  return new Promise((resolve, reject) => {
    fetchRemoteEntry(remoteEntries)
      .then(remotes => resolve({
        target: 'async-node',
        mode: 'development',
        devtool: false,
        entry: [path.resolve(__dirname, 'src/index.js')],
        output: {
          publicPath: 'http://localhost:8070',
          path: path.resolve(__dirname, 'dist'),
          libraryTarget: 'commonjs',
        },
        // externals: nodeExternals({
        //   allowlist: [/webpack\/container/],
        // }),
        resolve: {
          extensions: ['.js'],
        },
        module: {
          rules: [
            {
              test: /\.js?$/,
              exclude: /node_modules/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: ['@babel/preset-env'],
                }
              }
            },
          ]
        },
        plugins: [
          new ContainerReferencePlugin({
            remoteType: 'commonjs-module',
            remotes: remotes
          }),
          // new ModuleFederationPlugin({
          //   remoteType: 'commonjs-module',
          //   remotes: remotes,
          //   shared: {
          //     ...sharedDependencies,
          //     uuid: {
          //       eager: true
          //     }
          //   }
          // })
        ]
      }));
  });
}
