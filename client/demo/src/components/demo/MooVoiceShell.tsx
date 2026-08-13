import React, { useEffect, useState } from "react";
import { ModelSlotControl } from "./b00_ModelSlotControl";

type Mode = "simple" | "advanced";
type Preset = "low-latency" | "balanced" | "studio";

const STORAGE_KEY = "moovoice.ui.mode";

export const MooVoiceShell = () => {
    const [mode, setMode] = useState<Mode>(() => {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return saved === "advanced" ? "advanced" : "simple";
    });
    const [preset, setPreset] = useState<Preset>("balanced");
    const [legacyVisible, setLegacyVisible] = useState(false);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEY, mode);
    }, [mode]);

    return (
        <div className="moo-app">
            <aside className="moo-sidebar">
                <div className="moo-brand">
                    <div className="moo-mark" aria-hidden="true">
                        <span />
                        <span />
                    </div>
                    <div>
                        <div className="moo-brand-name">MooVoice</div>
                        <div className="moo-brand-version">Preview 0.1</div>
                    </div>
                </div>

                <nav className="moo-nav" aria-label="MooVoice">
                    <button className="moo-nav-item active"><span>⌂</span>Home</button>
                    <button className="moo-nav-item"><span>◉</span>Voice models</button>
                    <button className="moo-nav-item"><span>⌁</span>Audio setup</button>
                    <button className="moo-nav-item"><span>⌁</span>Performance</button>
                    <button className="moo-nav-item"><span>⚙</span>Settings</button>
                </nav>

                <div className="moo-sidebar-footer">
                    <div className="moo-system-pill"><i /> NVIDIA CUDA ready</div>
                    <div className="moo-maintainer">Maintained by IUMoo</div>
                </div>
            </aside>

            <main className="moo-main">
                <header className="moo-topbar">
                    <div>
                        <p className="moo-eyebrow">REAL-TIME VOICE TRANSFORMATION</p>
                        <h1>Good to see you.</h1>
                        <p className="moo-subtitle">Choose a voice, check your audio, and start converting.</p>
                    </div>
                    <div className="moo-mode-switch" role="group" aria-label="Interface mode">
                        <button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>Simple</button>
                        <button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced</button>
                    </div>
                </header>

                <section className="moo-status-card">
                    <div className="moo-orb" aria-label="Moo Orb is idle">
                        <div className="moo-ear left" />
                        <div className="moo-ear right" />
                        <div className="moo-eye left" />
                        <div className="moo-eye right" />
                        <div className="moo-muzzle"><b /><b /><b /><b /><b /></div>
                    </div>
                    <div className="moo-status-copy">
                        <div className="moo-status-label"><i /> READY</div>
                        <h2>MooVoice is standing by</h2>
                        <p>Select a model and confirm your audio route before starting.</p>
                    </div>
                    <button className="moo-primary-button">
                        <span className="moo-play">▶</span>
                        Start Converting
                    </button>
                </section>

                <section className="moo-wave-card" aria-label="Audio preview">
                    <div className="moo-wave-header">
                        <div>
                            <span>LIVE AUDIO</span>
                            <strong>No signal yet</strong>
                        </div>
                        <div className="moo-latency">Estimated latency <strong>Balanced</strong></div>
                    </div>
                    <div className="moo-wave" aria-hidden="true">
                        {Array.from({ length: 54 }).map((_, index) => (
                            <i key={index} style={{ height: `${8 + ((index * 17) % 28)}px` }} />
                        ))}
                    </div>
                </section>

                <section className="moo-grid">
                    <article className="moo-panel">
                        <div className="moo-panel-heading">
                            <div><span className="moo-icon">◉</span><div><h3>Voice model</h3><p>Choose how you want to sound</p></div></div>
                            <button>Browse models</button>
                        </div>
                        <div className="moo-empty">
                            <div className="moo-empty-icon">＋</div>
                            <div><strong>No model selected</strong><span>Drop an RVC model here or browse your library</span></div>
                        </div>
                    </article>

                    <article className="moo-panel">
                        <div className="moo-panel-heading">
                            <div><span className="moo-icon">⌁</span><div><h3>Audio route</h3><p>Microphone to converted output</p></div></div>
                            <button>Test audio</button>
                        </div>
                        <label className="moo-field"><span>MICROPHONE</span><select disabled><option>Select your microphone</option></select></label>
                        <div className="moo-route-line"><i /><i /><i /></div>
                        <label className="moo-field"><span>OUTPUT</span><select disabled><option>Select your output</option></select></label>
                    </article>
                </section>

                <section className="moo-performance">
                    <div className="moo-section-title">
                        <div><h3>Performance preset</h3><p>We will recommend the best setting for your hardware.</p></div>
                        <span>RTX 4070 Laptop GPU detected</span>
                    </div>
                    <div className="moo-preset-grid">
                        {[
                            ["low-latency", "Low Latency", "Fastest response for live chat", "Discord · Game chat"],
                            ["balanced", "Balanced", "The best starting point", "Everyday use"],
                            ["studio", "Studio", "Prioritize sound quality", "Recording · Production"],
                        ].map(([id, title, copy, meta]) => (
                            <button key={id} className={preset === id ? "moo-preset active" : "moo-preset"} onClick={() => setPreset(id as Preset)}>
                                <span className="moo-radio" />
                                <strong>{title}</strong>
                                <small>{copy}</small>
                                <em>{meta}</em>
                            </button>
                        ))}
                    </div>
                </section>

                {mode === "advanced" && (
                    <section className="moo-advanced">
                        <div><span>Chunk size</span><strong>Automatic</strong></div>
                        <div><span>Pitch detector</span><strong>RMVPE</strong></div>
                        <div><span>Compute device</span><strong>CUDA · GPU 0</strong></div>
                        <div><span>Buffer protection</span><strong>Enabled</strong></div>
                    </section>
                )}

                <section className="moo-legacy-gate">
                    <div>
                        <strong>Engine compatibility controls</strong>
                        <span>Use the original interface while MooVoice controls are being connected.</span>
                    </div>
                    <button onClick={() => setLegacyVisible((value) => !value)}>
                        {legacyVisible ? "Hide legacy interface" : "Open legacy interface"}
                    </button>
                </section>

                {legacyVisible && <div className="moo-legacy"><ModelSlotControl /></div>}
            </main>
        </div>
    );
};
