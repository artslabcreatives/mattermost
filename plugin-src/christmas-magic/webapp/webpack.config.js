const path = require('path');

module.exports = {
    entry: './src/index.tsx',
    resolve: {extensions: ['.ts', '.tsx', '.js']},
    module: {rules: [
        {test: /\.tsx?$/, exclude: /node_modules/, use: {loader: 'babel-loader', options: {presets: [
            ['@babel/preset-env', {targets: {chrome: 100, firefox: 100, safari: '15.4'}}],
            ['@babel/preset-react', {runtime: 'classic'}],
            '@babel/preset-typescript',
        ]}}},
        {test: /\.css$/, type: 'asset/source'},
    ]},
    externals: {react: 'React', 'react-dom': 'ReactDOM'},
    output: {path: path.join(__dirname, 'dist'), filename: 'main.js'},
    devtool: false,
};
