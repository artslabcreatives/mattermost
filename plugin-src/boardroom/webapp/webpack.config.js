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
            {
                test: /\.scss$/,
                use: ['style-loader', 'css-loader', 'sass-loader'],
            },
        ],
    },

    // The host webapp already loads these and exposes them on window; bundling
    // our own copies would break hooks and duplicate the Redux store.
    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        redux: 'Redux',
        'react-redux': 'ReactRedux',
        'react-router-dom': 'ReactRouterDom',
        'prop-types': 'PropTypes',
    },

    output: {
        devtoolNamespace: PLUGIN_ID,
        path: path.join(__dirname, '/dist'),
        publicPath: '/',
        filename: 'main.js',
    },

    devtool: 'source-map',
};
