const path = require("path");
const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

const engineTarget = process.env.MOOVOICE_ENGINE_URL || "http://127.0.0.1:18888";

// This Webpack version accepts one RegExp or an array of glob strings.
// A single RegExp handles both Windows separators and protected system files.
const ignoredWatchPaths =
    /(?:[\\/](?:node_modules|dist|logs|\.git)[\\/])|(?:^[A-Za-z]:[\\/](?:DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)$)/i;

module.exports = merge(common, {
    mode: "development",
    watchOptions: {
        aggregateTimeout: 250,
        poll: 1000,
        followSymlinks: false,
        ignored: ignoredWatchPaths,
    },
    devServer: {
        static: {
            directory: path.join(__dirname, "public"),
            watch: false,
        },
        client: {
            overlay: {
                errors: false,
                warnings: false,
            },
        },
        host: "0.0.0.0",
        server: "https",
        proxy: [
            {
                context: [
                    "/info",
                    "/performance",
                    "/update_settings",
                    "/upload_file",
                    "/concat_uploaded_file",
                    "/load_model",
                    "/merge_model",
                    "/update_model_default",
                    "/onnx",
                    "/onnx_export",
                    "/model_type",
                    "/socket.io",
                ],
                target: engineTarget,
                secure: false,
                changeOrigin: true,
                ws: true,
            },
        ],
    },
});
