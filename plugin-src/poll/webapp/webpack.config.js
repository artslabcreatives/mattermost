const path = require('path');
const PLUGIN_ID = require('../plugin.json').id;

module.exports = {
    entry: ['./src/index.tsx'],

    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },

    module: {
        rules: [
            {
                test: /\.(ts|tsx|js|jsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {targets: {chrome: 90}}],
                            ['@babel/preset-react', {runtime: 'automatic'}],
                            '@babel/preset-typescript',
                        ],
                    },
                },
            },
        ],
    },

    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        redux: 'Redux',
        'react-redux': 'ReactRedux',
    },

    output: {
        devtoolNamespace: PLUGIN_ID,
        path: path.join(__dirname, '/dist'),
        publicPath: '/',
        filename: 'main.js',
    },

    devtool: 'source-map',
};
