const path = require("path");
const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");

const engineTarget = process.env.MOOVOICE_ENGINE_URL || "http://127.0.0.1:18888";

module.exports = merge(common, {
    mode: "development",
    watchOptions: {
        aggregateTimeout: 250,
        ignored: [
            "**/node_modules/**",
            "**/dist/**",
            "**/logs/**",
            "**/.git/**",
            "C:/DumpStack.log.tmp",
            "C:/hiberfil.sys",
            "C:/pagefile.sys",
            "C:/swapfile.sys",
        ],
    },
    devServer: {
        static: {
            directory: path.join(__dirname, "public"),
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
        watchFiles: {
            paths: [
                path.join(__dirname, "src/**/*"),
                path.join(__dirname, "public/**/*"),
            ],
            options: {
                usePolling: false,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 50,
                },
                ignored: [
                    "**/node_modules/**",
                    "**/dist/**",
                    "**/logs/**",
                    "**/.git/**",
                ],
            },
        },
    },
});
