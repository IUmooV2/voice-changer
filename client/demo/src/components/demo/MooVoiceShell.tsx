import React, { useEffect, useState } from "react";
import { ModelSlotControl } from "./b00_ModelSlotControl";
import { useAppState } from "../../001_provider/001_AppStateProvider";
import { useGuiState } from "./001_GuiStateProvider";

type Mode = "simple" | "advanced";
type Preset = "low-latency" | "balanced" | "studio";
type AudioState = "idle" | "requesting" | "ready" | "error";

const MODE_KEY = "moovoice.ui.mode";
const INPUT_KEY = "moovoice.audio.input";
const OUTPUT_KEY = "moovoice.audio.output";

export const MooVoiceShell = () => {
    const appState = useAppState();
    const guiState = useGuiState();
    const clientReady = appState.initialized;
    const [engineOnline, setEngineOnline] = useState(false);
    const [engineCheckComplete, setEngineCheckComplete] = useState(false);
    const engineConnected = clientReady && engineOnline;
    const server = appState.serverSetting.serverSetting;
    const modelSlots = server.modelSlots || [];
    const selectedModel = modelSlots.find((slot) => String(slot.slotIndex) === String(server.modelSlotIndex))
        || (typeof server.modelSlotIndex === "number" ? modelSlots[server.modelSlotIndex] : undefined);
    const modelReady = engineConnected && Boolean(selectedModel?.modelFile);
    const selectedGpu = server.gpus?.find((gpu) => gpu.id === server.gpu);
    const computeLabel = server.gpu === -1 ? "CPU" : selectedGpu?.name || (engineConnected ? "GPU not selected" : "Engine offline");
    const [mode, setMode] = useState<Mode>(() => window.localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple");
    const [preset, setPreset] = useState<Preset>("balanced");
    const [presetBusy, setPresetBusy] = useState(false);
    const [legacyVisible, setLegacyVisible] = useState(false);
    const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
    const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
    const [inputId, setInputId] = useState(() => window.localStorage.getItem(INPUT_KEY) || "");
    const [outputId, setOutputId] = useState(() => window.localStorage.getItem(OUTPUT_KEY) || "");
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [audioMessage, setAudioMessage] = useState("Select your microphone, then run an audio test.");

    const loadDevices = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputs(devices.filter((device) => device.kind === "audioinput"));
        setOutputs(devices.filter((device) => device.kind === "audiooutput"));
    };

    useEffect(() => {
        window.localStorage.setItem(MODE_KEY, mode);
    }, [mode]);

    useEffect(() => {
        let active = true;
        const probeEngine = async () => {
            try {
                const response = await fetch("/info", { cache: "no-store" });
                const contentType = response.headers.get("content-type") || "";
                if (!response.ok || !contentType.includes("application/json")) throw new Error("No engine response");
                const info = await response.json();
                if (active) setEngineOnline(Boolean(info && (info.modelSlots || info.voiceChangerParams)));
            } catch {
                if (active) setEngineOnline(false);
            } finally {
                if (active) setEngineCheckComplete(true);
            }
        };
        probeEngine();
        const timer = window.setInterval(probeEngine, 3000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        if (!engineConnected || !server.gpus?.length || selectedGpu) return;
        const preferredGpu = server.gpus[0];
        appState.serverSetting.updateServerSettings({
            ...server,
            gpu: preferredGpu.id,
        }).catch(() => undefined);
    }, [engineConnected, server.gpu, server.gpus?.length]);

    useEffect(() => {
        loadDevices();
        const listener = () => loadDevices();
        navigator.mediaDevices?.addEventListener("devicechange", listener);
        return () => navigator.mediaDevices?.removeEventListener("devicechange", listener);
    }, []);

    useEffect(() => {
        if (inputId) window.localStorage.setItem(INPUT_KEY, inputId);
    }, [inputId]);

    useEffect(() => {
        if (outputId) window.localStorage.setItem(OUTPUT_KEY, outputId);
    }, [outputId]);

    useEffect(() => {
        appState.setAudioOutputElementId("moovoice-audio-output");
        appState.setAudioMonitorElementId("moovoice-audio-monitor");
    }, [appState.initialized]);

    const updateInput = async (value: string) => {
        setInputId(value);
        guiState.setAudioInputForGUI(value || "none");
        if (!value) return;
        try {
            await appState.setVoiceChangerClientSetting({
                ...appState.setting.voiceChangerClientSetting,
                audioInput: value,
            });
        } catch (error) {
            setAudioState("error");
            setAudioMessage(error instanceof Error ? error.message : "The engine could not use this microphone.");
        }
    };

    const updateOutput = async (value: string) => {
        setOutputId(value);
        guiState.setAudioOutputForGUI(value || "none");
        const element = document.getElementById("moovoice-audio-output") as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (element?.setSinkId) {
            try {
                await element.setSinkId(value);
            } catch (error) {
                setAudioState("error");
                setAudioMessage(error instanceof Error ? error.message : "The browser could not use this output.");
            }
        }
    };

    const toggleConversion = async () => {
        if (!engineConnected || !modelReady || !inputId) return;
        if (guiState.isConverting) {
            guiState.setIsConverting(false);
            await appState.stop();
        } else {
            guiState.setIsConverting(true);
            await appState.start();
        }
    };

    const testAudio = async () => {
        setAudioState("requesting");
        setAudioMessage("Waiting for microphone permission…");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: inputId ? { deviceId: { exact: inputId } } : true,
            });
            await loadDevices();
            const track = stream.getAudioTracks()[0];
            setAudioState("ready");
            setAudioMessage(`Microphone ready: ${track?.label || "default microphone"}`);
            window.setTimeout(() => stream.getTracks().forEach((item) => item.stop()), 1500);
        } catch (error) {
            setAudioState("error");
            setAudioMessage(error instanceof Error ? error.message : "MooVoice could not access the microphone.");
        }
    };

    const applyPreset = async (nextPreset: Preset) => {
        const profiles: Record<Preset, { chunk: number; extra: number; quality: number }> = {
            "low-latency": { chunk: 64, extra: 4096, quality: 0 },
            balanced: { chunk: 96, extra: 8192, quality: 1 },
            studio: { chunk: 192, extra: 16384, quality: 1 },
        };
        const profile = profiles[nextPreset];
        setPreset(nextPreset);
        if (!engineConnected) return;
        setPresetBusy(true);
        try {
            appState.setWorkletNodeSetting({
                ...appState.setting.workletNodeSetting,
                inputChunkNum: profile.chunk,
            });
            await appState.serverSetting.updateServerSettings({
                ...server,
                serverReadChunkSize: profile.chunk,
                extraConvertSize: profile.extra,
                rvcQuality: profile.quality,
                f0Detector: "rmvpe_onnx",
            });
            await appState.trancateBuffer();
        } finally {
            setPresetBusy(false);
        }
    };

    const selectGpu = async (gpu: number) => {
        await appState.serverSetting.updateServerSettings({ ...server, gpu });
    };

    const selectModel = async (slotIndex: number | string) => {
        await appState.serverSetting.updateServerSettings({
            ...server,
            modelSlotIndex: typeof slotIndex === "number" ? slotIndex : Number(slotIndex),
        });
    };

    const availableModels = modelSlots.filter((slot) => Boolean(slot.modelFile));

    const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

    return (
        <div className="moo-app">
            <aside className="moo-sidebar">
                <div className="moo-brand"><div className="moo-mark" aria-hidden="true"><span /><span /></div><div><div className="moo-brand-name">MooVoice</div><div className="moo-brand-version">Preview 0.1</div></div></div>
                <nav className="moo-nav" aria-label="MooVoice">
                    <button className="moo-nav-item active" onClick={() => scrollTo("moo-home")}><span>⌂</span>Home</button>
                    <button className="moo-nav-item" onClick={() => scrollTo("moo-models")}><span>◉</span>Voice models</button>
                    <button className="moo-nav-item" onClick={() => scrollTo("moo-audio")}><span>⌁</span>Audio setup</button>
                    <button className="moo-nav-item" onClick={() => scrollTo("moo-performance")}><span>⌁</span>Performance</button>
                    <button className="moo-nav-item" onClick={() => setMode("advanced")}><span>⚙</span>Settings</button>
                </nav>
                <div className="moo-sidebar-footer"><div className={engineConnected ? "moo-system-pill connected" : "moo-system-pill offline"}><i /> {engineConnected ? `Engine connected · ${computeLabel}` : "Engine offline"}</div><div className="moo-maintainer">Maintained by IUMoo</div></div>
            </aside>

            <main className="moo-main" id="moo-home">
                <header className="moo-topbar">
                    <div><p className="moo-eyebrow">REAL-TIME VOICE TRANSFORMATION</p><h1>Good to see you.</h1><p className="moo-subtitle">Choose a voice, check your audio, and start converting.</p></div>
                    <div className="moo-mode-switch" role="group" aria-label="Interface mode"><button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>Simple</button><button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced</button></div>
                </header>

                {!engineConnected && engineCheckComplete && (
                    <section className="moo-engine-setup">
                        <div className="moo-engine-setup-icon">!</div>
                        <div>
                            <strong>Conversion engine is not running</strong>
                            <span>The browser preview is working, but voice models, CUDA, and live conversion require the MooVoice server.</span>
                        </div>
                        <div className="moo-engine-steps"><b>1</b><span>Install engine</span><b>2</b><span>Launch server</span><b>3</b><span>MooVoice reconnects automatically</span></div>
                    </section>
                )}

                <section className="moo-status-card">
                    <div className="moo-orb" aria-label="Moo Orb is idle"><div className="moo-ear left" /><div className="moo-ear right" /><div className="moo-eye left" /><div className="moo-eye right" /><div className="moo-muzzle"><b /><b /><b /><b /><b /></div></div>
                    <div className="moo-status-copy"><div className="moo-status-label"><i /> {guiState.isConverting ? "LIVE" : engineConnected ? "READY" : "OFFLINE"}</div><h2>{guiState.isConverting ? "Voice conversion is active" : engineConnected ? "MooVoice is standing by" : "Start the MooVoice engine"}</h2><p>{engineConnected ? (modelReady ? "Confirm your audio route, then start converting." : "Import or select an RVC model to continue.") : "The interface is ready, but the conversion server is not connected."}</p></div>
                    <button className="moo-primary-button" disabled={!engineConnected || !modelReady || !inputId} onClick={toggleConversion} title={!engineConnected ? "Start the conversion engine first" : !modelReady ? "Select a voice model first" : !inputId ? "Select a microphone first" : ""}><span className="moo-play">{guiState.isConverting ? "■" : "▶"}</span>{guiState.isConverting ? "Stop Converting" : "Start Converting"}</button>
                </section>

                <section className="moo-wave-card" aria-label="Audio preview"><div className="moo-wave-header"><div><span>LIVE AUDIO</span><strong>{audioState === "ready" ? "Microphone connected" : "No signal yet"}</strong></div><div className="moo-latency">Performance preset <strong>{preset === "low-latency" ? "Low Latency" : preset === "studio" ? "Studio" : "Balanced"}</strong></div></div><div className="moo-wave" aria-hidden="true">{Array.from({ length: 54 }).map((_, index) => <i key={index} style={{ height: `${8 + ((index * 17) % 28)}px` }} />)}</div></section>

                <section className="moo-grid">
                    <article className="moo-panel" id="moo-models">
                        <div className="moo-panel-heading"><div><span className="moo-icon">◉</span><div><h3>Voice model</h3><p>Choose how you want to sound</p></div></div><button onClick={() => setLegacyVisible(true)}>Browse models</button></div>
                        {availableModels.length > 0 ? (
                            <div className="moo-model-list">
                                {availableModels.slice(0, 8).map((slot) => (
                                    <button
                                        key={String(slot.slotIndex)}
                                        className={String(slot.slotIndex) === String(server.modelSlotIndex) ? "moo-model-option active" : "moo-model-option"}
                                        onClick={() => selectModel(slot.slotIndex)}
                                    >
                                        <span>{String(slot.name || "Voice").slice(0, 1).toUpperCase()}</span>
                                        <div><strong>{slot.name || `Voice ${slot.slotIndex}`}</strong><small>{slot.voiceChangerType}</small></div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="moo-empty" onClick={() => setLegacyVisible(true)}><div className="moo-empty-icon">＋</div><div><strong>No model selected</strong><span>Open the model library to import an RVC model</span></div></div>
                        )}
                    </article>

                    <article className="moo-panel" id="moo-audio">
                        <div className="moo-panel-heading"><div><span className="moo-icon">⌁</span><div><h3>Audio route</h3><p>Microphone to converted output</p></div></div><button onClick={testAudio} disabled={audioState === "requesting"}>{audioState === "requesting" ? "Testing…" : "Test audio"}</button></div>
                        <label className="moo-field"><span>MICROPHONE</span><select value={inputId} onChange={(event) => updateInput(event.target.value)}><option value="">System default microphone</option>{inputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
                        <div className="moo-route-line"><i /><i /><i /></div>
                        <label className="moo-field"><span>OUTPUT</span><select value={outputId} onChange={(event) => updateOutput(event.target.value)}><option value="">System default output</option>{outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}</select></label>
                        <div className={`moo-audio-message ${audioState}`}>{audioMessage}</div>
                    </article>
                </section>

                <section className="moo-performance" id="moo-performance">
                    <div className="moo-section-title"><div><h3>Performance preset</h3><p>{presetBusy ? "Applying engine settings…" : "Choose a tuned starting point for your workload."}</p></div>{engineConnected && server.gpus?.length ? <label className="moo-gpu-select"><span>COMPUTE</span><select value={server.gpu} onChange={(event) => selectGpu(Number(event.target.value))}>{server.gpus.map((gpu) => <option key={gpu.id} value={gpu.id}>{gpu.name}</option>)}<option value={-1}>CPU</option></select></label> : <span>Connect engine to detect hardware</span>}</div>
                    <div className="moo-preset-grid">{[["low-latency","Low Latency","Fastest response for live chat","Discord · Game chat"],["balanced","Balanced","The best starting point","Everyday use"],["studio","Studio","Prioritize sound quality","Recording · Production"]].map(([id,title,copy,meta]) => <button key={id} className={preset === id ? "moo-preset active" : "moo-preset"} onClick={() => applyPreset(id as Preset)} disabled={presetBusy}><span className="moo-radio" /><strong>{title}</strong><small>{copy}</small><em>{meta}</em></button>)}</div>
                </section>

                {mode === "advanced" && <section className="moo-advanced"><div><span>Chunk size</span><strong>Automatic</strong></div><div><span>Pitch detector</span><strong>RMVPE</strong></div><div><span>Compute device</span><strong>{computeLabel}</strong></div><div><span>Buffer protection</span><strong>Enabled</strong></div></section>}

                <section className="moo-legacy-gate"><div><strong>Engine compatibility controls</strong><span>Use the original interface while MooVoice controls are being connected.</span></div><button onClick={() => setLegacyVisible((value) => !value)}>{legacyVisible ? "Hide legacy interface" : "Open legacy interface"}</button></section>
                {legacyVisible && <div className="moo-legacy"><ModelSlotControl /></div>}
                <audio hidden id="moovoice-audio-output" />
                <audio hidden id="moovoice-audio-monitor" />
            </main>
        </div>
    );
};
