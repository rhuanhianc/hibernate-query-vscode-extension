const path = require('path');

module.exports = {
  target: 'node', 
  mode: 'none', 
  
  entry: './src/extension.ts', 
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  
  devtool: 'source-map',
  
  externals: {
    vscode: 'commonjs vscode', 
  },
  
  resolve: {
    extensions: ['.ts', '.js'],
    modules: ['node_modules']
  },
  
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                "module": "commonjs",
              }
            }
          }
        ]
      }
    ]
  },

  performance: {
    hints: false
  }
};