import React, { useEffect, useState } from "react";
import { ModelSlotControl } from "./b00_ModelSlotControl";

type Mode = "simple" | "advanced";
type Preset = "low-latency" | "balanced" | "studio";
type AudioState = "idle" | "requesting" | "ready" | "error";

const MODE_KEY = "moovoice.ui.mode";
const INPUT_KEY = "moovoice.audio.input";
const OUTPUT_KEY = "moovoice.audio.output";

export const MooVoiceShell = () => {
    const [mode, setMode] = useState<Mode>(() => window.localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple");
    const [preset, setPreset] = useState<Preset>("balanced");
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
                <div className="moo-sidebar-footer"><div className="moo-system-pill"><i /> Engine connection pending</div><div className="moo-maintainer">Maintained by IUMoo</div></div>
            </aside>

            <main className="moo-main" id="moo-home">
                <header className="moo-topbar">
                    <div><p className="moo-eyebrow">REAL-TIME VOICE TRANSFORMATION</p><h1>Good to see you.</h1><p className="moo-subtitle">Choose a voice, check your audio, and start converting.</p></div>
                    <div className="moo-mode-switch" role="group" aria-label="Interface mode"><button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>Simple</button><button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced</button></div>
                </header>

                <section className="moo-status-card">
                    <div className="moo-orb" aria-label="Moo Orb is idle"><div className="moo-ear left" /><div className="moo-ear right" /><div className="moo-eye left" /><div className="moo-eye right" /><div className="moo-muzzle"><b /><b /><b /><b /><b /></div></div>
                    <div className="moo-status-copy"><div className="moo-status-label"><i /> SETUP</div><h2>MooVoice is standing by</h2><p>Select a model and confirm your audio route before starting.</p></div>
                    <button className="moo-primary-button" disabled title="Connect a model and audio route first"><span className="moo-play">▶</span>Start Converting</button>
                </section>

                <section className="moo-wave-card" aria-label="Audio preview"><div className="moo-wave-header"><div><span>LIVE AUDIO</span><strong>{audioState === "ready" ? "Microphone connected" : "No signal yet"}</strong></div><div className="moo-latency">Performance preset <strong>{preset === "low-latency" ? "Low Latency" : preset === "studio" ? "Studio" : "Balanced"}</strong></div></div><div className="moo-wave" aria-hidden="true">{Array.from({ length: 54 }).map((_, index) => <i key={index} style={{ height: `${8 + ((index * 17) % 28)}px` }} />)}</div></section>

                <section className="moo-grid">
                    <article className="moo-panel" id="moo-models">
                        <div className="moo-panel-heading"><div><span className="moo-icon">◉</span><div><h3>Voice model</h3><p>Choose how you want to sound</p></div></div><button onClick={() => setLegacyVisible(true)}>Browse models</button></div>
                        <div className="moo-empty" onClick={() => setLegacyVisible(true)}><div className="moo-empty-icon">＋</div><div><strong>No model selected</strong><span>Open the model library to import an RVC model</span></div></div>
                    </article>

                    <article className="moo-panel" id="moo-audio">
                        <div className="moo-panel-heading"><div><span className="moo-icon">⌁</span><div><h3>Audio route</h3><p>Microphone to converted output</p></div></div><button onClick={testAudio} disabled={audioState === "requesting"}>{audioState === "requesting" ? "Testing…" : "Test audio"}</button></div>
                        <label className="moo-field"><span>MICROPHONE</span><select value={inputId} onChange={(event) => setInputId(event.target.value)}><option value="">System default microphone</option>{inputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
                        <div className="moo-route-line"><i /><i /><i /></div>
                        <label className="moo-field"><span>OUTPUT</span><select value={outputId} onChange={(event) => setOutputId(event.target.value)}><option value="">System default output</option>{outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}</select></label>
                        <div className={`moo-audio-message ${audioState}`}>{audioMessage}</div>
                    </article>
                </section>

                <section className="moo-performance" id="moo-performance">
                    <div className="moo-section-title"><div><h3>Performance preset</h3><p>Preset selection will be connected to the engine after calibration.</p></div><span>Hardware detection coming next</span></div>
                    <div className="moo-preset-grid">{[["low-latency","Low Latency","Fastest response for live chat","Discord · Game chat"],["balanced","Balanced","The best starting point","Everyday use"],["studio","Studio","Prioritize sound quality","Recording · Production"]].map(([id,title,copy,meta]) => <button key={id} className={preset === id ? "moo-preset active" : "moo-preset"} onClick={() => setPreset(id as Preset)}><span className="moo-radio" /><strong>{title}</strong><small>{copy}</small><em>{meta}</em></button>)}</div>
                </section>

                {mode === "advanced" && <section className="moo-advanced"><div><span>Chunk size</span><strong>Automatic</strong></div><div><span>Pitch detector</span><strong>RMVPE</strong></div><div><span>Compute device</span><strong>Not detected</strong></div><div><span>Buffer protection</span><strong>Enabled</strong></div></section>}

                <section className="moo-legacy-gate"><div><strong>Engine compatibility controls</strong><span>Use the original interface while MooVoice controls are being connected.</span></div><button onClick={() => setLegacyVisible((value) => !value)}>{legacyVisible ? "Hide legacy interface" : "Open legacy interface"}</button></section>
                {legacyVisible && <div className="moo-legacy"><ModelSlotControl /></div>}
            </main>
        </div>
    );
};
