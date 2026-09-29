const path = require('node:path');
module.exports = {
  context: __dirname,
  target: 'node',
  entry: './src/extension.ts',
  output: { path: path.join(__dirname, 'dist'), filename: 'extension.js', libraryTarget: 'commonjs2' },
  externals: { vscode: 'commonjs vscode' },
  resolve: { extensions: ['.ts', '.js'] },
  resolveLoader: { modules: [path.join(__dirname, '../node_modules')] },
  module: { rules: [{
    test: /\.ts$/,
    exclude: /node_modules/,
    use: { loader: 'ts-loader', options: { configFile: path.join(__dirname, 'tsconfig.json') } }
  }] },
  devtool: false
};
