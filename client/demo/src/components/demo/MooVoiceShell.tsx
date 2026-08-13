import React, { useEffect, useState } from "react";
import { ModelUploadSetting } from "@dannadori/voice-changer-client-js";
import { ModelSlotControl } from "./b00_ModelSlotControl";
import { useAppState } from "../../001_provider/001_AppStateProvider";
import { useGuiState } from "./001_GuiStateProvider";

type Mode = "simple" | "advanced";
type Preset = "low-latency" | "balanced" | "studio";
type VoiceProfile = "natural" | "full" | "bright" | "deep";
type RvcPreference = { tran: number; indexRatio: number; protect: number; profile?: VoiceProfile | "custom" };
type PendingProfileRestore = { slotIndex: string | number; settings: RvcPreference; label: string };
type RvcMetadata = { displayName?: string; tags?: string; notes?: string; favorite?: boolean };
type AudioState = "idle" | "requesting" | "ready" | "error";
type AuditionClip = { id: number; sampleNumber: number; label: string; detail: string; filename: string; createdAt: string; url: string };

const MODE_KEY = "moovoice.ui.mode";
const INPUT_KEY = "moovoice.audio.input";
const OUTPUT_KEY = "moovoice.audio.output";
const RVC_PREFERENCES_KEY = "moovoice.rvc.preferences";
const RVC_METADATA_KEY = "moovoice.rvc.metadata";
const MAX_MODEL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024 * 1024;
const JVS_FAVORITES_KEY = "moovoice.jvs.favorites";
const JVS_ALIASES_KEY = "moovoice.jvs.aliases";
const JVS_RANGE_LABELS: Record<number, string> = { [-2]: "Much lower", [-1]: "Lower", 0: "Natural", 1: "Higher", 2: "Much higher" };
const VOICE_PROFILES: Record<VoiceProfile, { tran: number; indexRatio: number; protect: number; label: string; description: string }> = {
    natural: { tran: 0, indexRatio: 0.55, protect: 0.33, label: "Natural", description: "Balanced identity" },
    full: { tran: 0, indexRatio: 0.85, protect: 0.22, label: "Full", description: "Strongest model character" },
    bright: { tran: 9, indexRatio: 0.78, protect: 0.28, label: "Bright", description: "Higher, lighter range" },
    deep: { tran: -5, indexRatio: 0.72, protect: 0.3, label: "Deep", description: "Lower, heavier range" },
};
const jvsFavoriteKey = (speakerId: number, pitch: number) => `${speakerId}:${pitch}`;
const rvcPreferenceKey = (slot: { slotIndex: string | number; modelFile?: string; name?: string }) => `${String(slot.slotIndex)}:${String(slot.modelFile || slot.name || "rvc")}`;

const readJsonSetting = <T,>(key: string, fallback: T): T => {
    try {
        const value = window.localStorage.getItem(key);
        return value ? JSON.parse(value) as T : fallback;
    } catch {
        return fallback;
    }
};

const createWavBlob = (samples: Float32Array, sampleRate = 48000) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (offset: number, text: string) => Array.from(text).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
        const value = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    });
    return new Blob([buffer], { type: "audio/wav" });
};

const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
};

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
    const isBeatriceJvs = selectedModel?.slotIndex === "Beatrice-JVS" || selectedModel?.voiceChangerType === "Beatrice";
    const modelReady = engineConnected && Boolean(selectedModel && (selectedModel.modelFile || isBeatriceJvs));
    const selectedGpu = server.gpus?.find((gpu) => gpu.id === server.gpu);
    const computeLabel = server.gpu === -1 ? "CPU" : selectedGpu?.name || (engineConnected ? "GPU not selected" : "Engine offline");
    const [mode, setMode] = useState<Mode>(() => window.localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple");
    const [preset, setPreset] = useState<Preset>("balanced");
    const [presetBusy, setPresetBusy] = useState(false);
    const [profileApplying, setProfileApplying] = useState("");
    const [pendingProfileRestore, setPendingProfileRestore] = useState<PendingProfileRestore | null>(null);
    const [rvcPreferences, setRvcPreferences] = useState<Record<string, RvcPreference>>(
        () => readJsonSetting<Record<string, RvcPreference>>(RVC_PREFERENCES_KEY, {})
    );
    const [rvcMetadata, setRvcMetadata] = useState<Record<string, RvcMetadata>>(
        () => readJsonSetting<Record<string, RvcMetadata>>(RVC_METADATA_KEY, {})
    );
    const [legacyVisible, setLegacyVisible] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importName, setImportName] = useState("");
    const [importModel, setImportModel] = useState<File | null>(null);
    const [importIndex, setImportIndex] = useState<File | null>(null);
    const [importSlot, setImportSlot] = useState(0);
    const [importError, setImportError] = useState("");
    const [importReplacing, setImportReplacing] = useState(false);
    const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
    const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
    const [inputId, setInputId] = useState(() => window.localStorage.getItem(INPUT_KEY) || "");
    const [outputId, setOutputId] = useState(() => window.localStorage.getItem(OUTPUT_KEY) || "");
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [audioMessage, setAudioMessage] = useState("Select your microphone, then run an audio test.");
    const [jvsFavorites, setJvsFavorites] = useState<string[]>(() => {
        const saved = readJsonSetting<Array<string | number>>(JVS_FAVORITES_KEY, []);
        return saved.map((item) => typeof item === "number" ? jvsFavoriteKey(item, 0) : item);
    });
    const [jvsAliases, setJvsAliases] = useState<Record<string, string>>(() => readJsonSetting<Record<string, string>>(JVS_ALIASES_KEY, {}));
    const [modelQuery, setModelQuery] = useState("");
    const [modelFavoritesOnly, setModelFavoritesOnly] = useState(false);
    const [jvsFavoritesOnly, setJvsFavoritesOnly] = useState(false);
    const [auditionRecording, setAuditionRecording] = useState(false);
    const [auditionError, setAuditionError] = useState("");
    const [auditionClips, setAuditionClips] = useState<AuditionClip[]>([]);
    const [auditionLabel, setAuditionLabel] = useState({ label: "", detail: "" });

    const loadDevices = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputs(devices.filter((device) => device.kind === "audioinput"));
        setOutputs(devices.filter((device) => device.kind === "audiooutput"));
    };

    useEffect(() => {
        window.localStorage.setItem(MODE_KEY, mode);
        if (mode === "simple") setLegacyVisible(false);
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
        window.localStorage.setItem(JVS_FAVORITES_KEY, JSON.stringify(jvsFavorites));
    }, [jvsFavorites]);

    useEffect(() => {
        window.localStorage.setItem(RVC_PREFERENCES_KEY, JSON.stringify(rvcPreferences));
    }, [rvcPreferences]);

    useEffect(() => {
        window.localStorage.setItem(RVC_METADATA_KEY, JSON.stringify(rvcMetadata));
    }, [rvcMetadata]);

    useEffect(() => {
        if (!pendingProfileRestore || String(server.modelSlotIndex) !== String(pendingProfileRestore.slotIndex)) return;
        let active = true;
        const restoreProfile = async () => {
            const settings = {
                tran: pendingProfileRestore.settings.tran,
                indexRatio: pendingProfileRestore.settings.indexRatio,
                protect: pendingProfileRestore.settings.protect,
            };
            try {
                // This effect runs after the model-change response has produced a fresh
                // server snapshot, so updateServerSettings will not resend modelSlotIndex.
                await appState.serverSetting.updateServerSettings({ ...server, ...settings });
                await appState.serverSetting.reloadServerInfo();
                await appState.trancateBuffer();
            } finally {
                if (active) {
                    setPendingProfileRestore(null);
                    setProfileApplying("");
                }
            }
        };
        restoreProfile();
        return () => {
            active = false;
        };
    }, [server.modelSlotIndex, pendingProfileRestore]);

    useEffect(() => {
        window.localStorage.setItem(JVS_ALIASES_KEY, JSON.stringify(jvsAliases));
    }, [jvsAliases]);

    useEffect(() => {
        appState.setAudioOutputElementId("moovoice-audio-output");
        const monitor = document.getElementById("moovoice-audio-monitor") as HTMLAudioElement | null;
        if (monitor) {
            monitor.pause();
            monitor.muted = true;
            monitor.volume = 0;
            monitor.srcObject = null;
        }
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

    const prepareAudioRoute = async () => {
        const output = document.getElementById("moovoice-audio-output") as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (!output) throw new Error("MooVoice output element is unavailable.");

        await appState.setVoiceChangerClientSetting({
            ...appState.setting.voiceChangerClientSetting,
            audioInput: inputId,
            outputGain: Math.max(appState.setting.voiceChangerClientSetting.outputGain || 1, 1),
        });

        appState.setAudioOutputElementId("moovoice-audio-output");
        output.volume = 1;
        output.muted = false;
        if (output.setSinkId) await output.setSinkId(outputId || "");
        await output.play();
        return output;
    };

    const toggleConversion = async () => {
        if (!engineConnected || !modelReady || !inputId) return;
        try {
            if (guiState.isConverting) {
                await appState.stop();
                guiState.setIsConverting(false);
                setAudioMessage("Conversion stopped.");
                return;
            }

            setAudioState("requesting");
            setAudioMessage("Connecting microphone, engine, and speaker…");
            await prepareAudioRoute();
            await appState.trancateBuffer();
            await appState.start();
            guiState.setIsConverting(true);
            setAudioMessage("Warming up the selected voice… wait a moment before speaking.");
            await new Promise<void>((resolve) => window.setTimeout(resolve, 1400));
            await appState.trancateBuffer();
            setAudioState("ready");
            setAudioMessage("Conversion is live. Speak into your microphone.");
        } catch (error) {
            guiState.setIsConverting(false);
            setAudioState("error");
            setAudioMessage(error instanceof Error ? error.message : "MooVoice could not start the audio route.");
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
            const resolvedInputId = track?.getSettings().deviceId || inputId || "default";
            if (!inputId) setInputId(resolvedInputId);
            await appState.setVoiceChangerClientSetting({
                ...appState.setting.voiceChangerClientSetting,
                audioInput: resolvedInputId,
            });

            const output = document.getElementById("moovoice-audio-output") as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
            if (output?.setSinkId) await output.setSinkId(outputId || "");
            setAudioState("ready");
            setAudioMessage(`Microphone ready: ${track?.label || "default microphone"}. Select a voice and start converting.`);
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

    const updateBeatriceVoice = (speakerId: number, pitch: number) => {
        guiState.setBeatriceJVSSpeakerId(Math.min(100, Math.max(1, speakerId)));
        guiState.setBeatriceJVSSpeakerPitch(pitch);
    };

    const jvsFavoriteSpeakerIds = Array.from(new Set(jvsFavorites.map((item) => Number(item.split(":")[0])))).sort((a, b) => a - b);
    const jvsBrowseIds = jvsFavoritesOnly && jvsFavoriteSpeakerIds.length > 0 ? jvsFavoriteSpeakerIds : Array.from({ length: 100 }, (_, index) => index + 1);

    const stepBeatriceVoice = (direction: -1 | 1) => {
        const currentIndex = jvsBrowseIds.indexOf(guiState.beatriceJVSSpeakerId);
        const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
        const nextIndex = (baseIndex + direction + jvsBrowseIds.length) % jvsBrowseIds.length;
        updateBeatriceVoice(jvsBrowseIds[nextIndex], guiState.beatriceJVSSpeakerPitch);
    };

    const toggleJvsFavorite = () => {
        const key = jvsFavoriteKey(guiState.beatriceJVSSpeakerId, guiState.beatriceJVSSpeakerPitch);
        setJvsFavorites((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    };

    const updateJvsAlias = (value: string) => {
        const key = String(guiState.beatriceJVSSpeakerId);
        setJvsAliases((current) => {
            const next = { ...current };
            if (value.trim()) next[key] = value;
            else delete next[key];
            return next;
        });
    };

    const getAuditionLabel = () => {
        if (isBeatriceJvs) {
            const speaker = jvsAliases[String(guiState.beatriceJVSSpeakerId)] || `JVS ${String(guiState.beatriceJVSSpeakerId).padStart(3, "0")}`;
            return { label: speaker, detail: JVS_RANGE_LABELS[guiState.beatriceJVSSpeakerPitch] || "Natural" };
        }
        return { label: String(selectedModel?.name || "Voice sample"), detail: String(selectedModel?.voiceChangerType || "RVC") };
    };

    const startAuditionRecording = () => {
        setAuditionError("");
        if (!guiState.isConverting || audioState !== "ready") {
            setAuditionError("Wait until voice conversion finishes warming up, then record.");
            return;
        }
        appState.startOutputRecording();
        setAuditionLabel(getAuditionLabel());
        setAuditionRecording(true);
    };

    const stopAuditionRecording = async () => {
        try {
            const samples = await appState.stopOutputRecording();
            setAuditionRecording(false);
            if (!samples || samples.length < 2400) {
                setAuditionError("No converted audio was captured. Keep conversion live and speak during recording.");
                return;
            }
            const url = URL.createObjectURL(createWavBlob(samples));
            setAuditionClips((current) => {
                const sampleNumber = current.reduce((highest, clip) => Math.max(highest, clip.sampleNumber), 0) + 1;
                const safeIdentity = `${auditionLabel.label}-${auditionLabel.detail}`
                    .toLocaleLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 48) || "voice";
                return [...current, {
                    id: Date.now(),
                    sampleNumber,
                    label: auditionLabel.label,
                    detail: auditionLabel.detail,
                    filename: `moovoice-sample-${String(sampleNumber).padStart(2, "0")}-${safeIdentity}.wav`,
                    createdAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
                    url,
                }];
            });
        } catch {
            setAuditionRecording(false);
            setAuditionError("MooVoice could not finish the converted-output recording.");
        }
    };

    const removeAuditionClip = (id: number) => {
        setAuditionClips((current) => {
            const target = current.find((clip) => clip.id === id);
            if (target) URL.revokeObjectURL(target.url);
            return current.filter((clip) => clip.id !== id);
        });
    };

    const clearAuditionClips = () => {
        auditionClips.forEach((clip) => URL.revokeObjectURL(clip.url));
        setAuditionClips([]);
    };

    const updateTransformation = async (
        changes: { tran?: number; indexRatio?: number; protect?: number },
        profile: VoiceProfile | "custom" = "custom"
    ) => {
        const savedPreference = selectedModel?.voiceChangerType === "RVC"
            ? rvcPreferences[rvcPreferenceKey(selectedModel)]
            : undefined;
        const nextSettings = {
            tran: changes.tran ?? savedPreference?.tran ?? Number(server.tran || 0),
            indexRatio: changes.indexRatio ?? savedPreference?.indexRatio ?? Number(server.indexRatio || 0),
            protect: changes.protect ?? savedPreference?.protect ?? Number(server.protect ?? 0.33),
        };
        await appState.serverSetting.updateServerSettings({ ...server, ...nextSettings });
        if (selectedModel?.voiceChangerType === "RVC") {
            const key = rvcPreferenceKey(selectedModel);
            setRvcPreferences((current) => ({ ...current, [key]: { ...nextSettings, profile } }));
        }
    };

    const applyVoiceProfile = async (profile: VoiceProfile) => {
        const { tran, indexRatio, protect } = VOICE_PROFILES[profile];
        await updateTransformation({ tran, indexRatio, protect }, profile);
    };

    const numericVoiceProfile = (Object.keys(VOICE_PROFILES) as VoiceProfile[]).find((profile) => {
        const settings = VOICE_PROFILES[profile];
        return Number(server.tran || 0) === settings.tran
            && Math.abs(Number(server.indexRatio || 0) - settings.indexRatio) < 0.001
            && Math.abs(Number(server.protect ?? 0.33) - settings.protect) < 0.001;
    });
    const selectedRvcPreference = selectedModel?.voiceChangerType === "RVC"
        ? rvcPreferences[rvcPreferenceKey(selectedModel)]
        : undefined;
    const savedNumericVoiceProfile = selectedRvcPreference
        ? (Object.keys(VOICE_PROFILES) as VoiceProfile[]).find((profile) => {
            const settings = VOICE_PROFILES[profile];
            return selectedRvcPreference.tran === settings.tran
                && Math.abs(selectedRvcPreference.indexRatio - settings.indexRatio) < 0.001
                && Math.abs(selectedRvcPreference.protect - settings.protect) < 0.001;
        })
        : undefined;
    const activeVoiceProfile = selectedRvcPreference?.profile === "custom"
        ? undefined
        : selectedRvcPreference?.profile || savedNumericVoiceProfile || numericVoiceProfile;
    const activeProfileSettings = activeVoiceProfile ? VOICE_PROFILES[activeVoiceProfile] : null;
    const displayedTransformation = activeProfileSettings || {
        tran: Number(server.tran || 0),
        indexRatio: Number(server.indexRatio || 0),
        protect: Number(server.protect ?? 0.33),
    };

    const selectModel = async (slotIndex: typeof server.modelSlotIndex) => {
        const targetModel = modelSlots.find((slot) => String(slot.slotIndex) === String(slotIndex))
            || (typeof slotIndex === "number" ? modelSlots[slotIndex] : undefined);
        const savedSettings = targetModel?.voiceChangerType === "RVC"
            ? rvcPreferences[rvcPreferenceKey(targetModel)]
            : undefined;
        const naturalDefaults: RvcPreference = {
            tran: VOICE_PROFILES.natural.tran,
            indexRatio: VOICE_PROFILES.natural.indexRatio,
            protect: VOICE_PROFILES.natural.protect,
            profile: "natural",
        };
        const restoredPreference = savedSettings || naturalDefaults;
        if (targetModel?.voiceChangerType === "RVC" && !savedSettings) {
            const key = rvcPreferenceKey(targetModel);
            setRvcPreferences((current) => ({ ...current, [key]: naturalDefaults }));
        }

        const restoreLabel = VOICE_PROFILES[restoredPreference.profile as VoiceProfile]?.label || "custom tuning";
        setProfileApplying(targetModel?.voiceChangerType === "RVC" ? `Applying ${restoreLabel}…` : "Switching voice…");
        if (targetModel?.voiceChangerType === "RVC") {
            setPendingProfileRestore({ slotIndex, settings: restoredPreference, label: restoreLabel });
        }
        await appState.serverSetting.updateServerSettings({
            ...server,
            modelSlotIndex: slotIndex,
        });
        if (targetModel?.voiceChangerType !== "RVC") {
            setProfileApplying("");
        }
    };

    const availableModels = modelSlots.filter((slot) => Boolean(slot.modelFile));
    const selectedModelMetadata: RvcMetadata = selectedModel?.voiceChangerType === "RVC"
        ? rvcMetadata[rvcPreferenceKey(selectedModel)] || {}
        : {};
    const favoriteModelCount = availableModels.filter((slot) => slot.voiceChangerType === "RVC" && rvcMetadata[rvcPreferenceKey(slot)]?.favorite).length;
    const visibleModels = availableModels
        .filter((slot) => !modelFavoritesOnly || (slot.voiceChangerType === "RVC" && rvcMetadata[rvcPreferenceKey(slot)]?.favorite))
        .filter((slot) => {
            const query = modelQuery.trim().toLocaleLowerCase();
            if (!query) return true;
            const metadata = slot.voiceChangerType === "RVC" ? rvcMetadata[rvcPreferenceKey(slot)] || {} : {};
            return `${slot.name || ""} ${slot.voiceChangerType || ""} ${metadata.displayName || ""} ${metadata.tags || ""} ${metadata.notes || ""}`
                .toLocaleLowerCase()
                .includes(query);
        })
        .sort((first, second) => {
            const firstFavorite = first.voiceChangerType === "RVC" && rvcMetadata[rvcPreferenceKey(first)]?.favorite ? 1 : 0;
            const secondFavorite = second.voiceChangerType === "RVC" && rvcMetadata[rvcPreferenceKey(second)]?.favorite ? 1 : 0;
            return secondFavorite - firstFavorite;
        });

    const updateRvcMetadata = (slot: typeof selectedModel, changes: RvcMetadata) => {
        if (!slot || slot.voiceChangerType !== "RVC") return;
        const key = rvcPreferenceKey(slot);
        setRvcMetadata((current) => ({ ...current, [key]: { ...(current[key] || {}), ...changes } }));
    };

    const openImporter = (replaceSlot?: number) => {
        const replacing = typeof replaceSlot === "number";
        const openSlot = modelSlots.findIndex((slot) => !slot.modelFile);
        setImportReplacing(replacing);
        setImportSlot(replacing ? replaceSlot : openSlot >= 0 ? openSlot : modelSlots.length);
        setImportName(replacing ? String(selectedModel?.name || "") : "");
        setImportModel(null);
        setImportIndex(null);
        setImportError("");
        setImportOpen(true);
    };

    const chooseModelFile = (file: File | null) => {
        if (!file) return;
        if (!/\.(pth|onnx)$/i.test(file.name)) {
            setImportError("Choose an RVC .pth or .onnx model file.");
            return;
        }
        if (file.size === 0) {
            setImportError("This model file is empty.");
            return;
        }
        if (file.size > MAX_MODEL_BYTES) {
            setImportError("This model is larger than the 2 GB import limit.");
            return;
        }
        setImportModel(file);
        if (!importName) setImportName(file.name.replace(/\.(pth|onnx)$/i, ""));
        setImportError("");
    };

    const chooseIndexFile = (file: File | null) => {
        if (!file) return;
        if (!/\.(index|bin)$/i.test(file.name)) {
            setImportError("The optional index must use .index or .bin.");
            return;
        }
        if (file.size === 0) {
            setImportError("This feature index is empty.");
            return;
        }
        if (file.size > MAX_INDEX_BYTES) {
            setImportError("This feature index is larger than the 1 GB import limit.");
            return;
        }
        setImportIndex(file);
        setImportError("");
    };

    const importRvcModel = async () => {
        if (!importModel) {
            setImportError("Select an RVC model file first.");
            return;
        }
        if (!importName.trim()) {
            setImportError("Give this voice a name.");
            return;
        }
        if (guiState.isConverting) {
            setImportError("Stop conversion before importing a model.");
            return;
        }

        const setting: ModelUploadSetting = {
            voiceChangerType: "RVC",
            slot: importSlot,
            isSampleMode: false,
            sampleId: null,
            files: [
                { kind: "rvcModel", file: importModel, dir: "" },
                ...(importIndex ? [{ kind: "rvcIndex" as const, file: importIndex, dir: "" }] : []),
            ],
            params: {},
        };

        try {
            setImportError("");
            await appState.serverSetting.uploadModel(setting);
            await appState.serverSetting.updateModelInfo(importSlot, "name", importName.trim());
            await appState.serverSetting.reloadServerInfo();
            await selectModel(importSlot);
            setImportOpen(false);
        } catch (error) {
            setImportError(error instanceof Error ? error.message : "The model could not be imported.");
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
                <div className="moo-sidebar-footer"><div className={engineConnected ? "moo-system-pill connected" : "moo-system-pill offline"}><i /> {engineConnected ? `Engine connected · ${computeLabel}` : "Engine offline"}</div><div className="moo-maintainer">Maintained by IUMoo</div></div>
            </aside>

            <main className="moo-main" id="moo-home">
                <header className="moo-topbar">
                    <div><p className="moo-eyebrow">REAL-TIME VOICE TRANSFORMATION</p><h1>Good to see you.</h1><p className="moo-subtitle">Choose a voice, check your audio, and start converting.</p></div>
                    <div className="moo-mode-switch" role="group" aria-label="Interface mode"><button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>Simple</button><button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced</button></div>
                </header>

                <section className={`moo-mode-summary ${mode}`} aria-live="polite">
                    <div><strong>{mode === "simple" ? "Simple mode" : "Advanced mode"}</strong><span>{mode === "simple" ? "Everyday controls with technical settings handled for you." : "Fine tuning, engine details, compute selection, and compatibility controls are visible."}</span></div>
                    <span>{mode === "simple" ? "ESSENTIALS" : "FULL CONTROL"}</span>
                </section>

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
                    <div className="moo-status-copy"><div className="moo-status-label"><i /> {guiState.isConverting ? "LIVE" : engineConnected ? "READY" : "OFFLINE"}</div><h2>{guiState.isConverting ? "Voice conversion is active" : engineConnected ? "MooVoice is standing by" : "Start the MooVoice engine"}</h2><p>{guiState.isConverting ? `Live with ${selectedModel?.name || "selected voice"} through ${computeLabel}.` : engineConnected ? (modelReady ? "Confirm your audio route, then start converting." : "Import or select a compatible voice model to continue.") : "The interface is ready, but the conversion server is not connected."}</p></div>
                    <button className="moo-primary-button" disabled={!engineConnected || !modelReady || !inputId} onClick={toggleConversion} title={!engineConnected ? "Start the conversion engine first" : !modelReady ? "Select a voice model first" : !inputId ? "Select a microphone first" : ""}><span className="moo-play">{guiState.isConverting ? "■" : "▶"}</span>{guiState.isConverting ? "Stop Converting" : "Start Converting"}</button>
                </section>

                <section className="moo-wave-card" aria-label="Audio preview"><div className="moo-wave-header"><div><span>LIVE AUDIO</span><strong>{audioState === "ready" ? "Microphone connected" : "No signal yet"}</strong></div><div className="moo-latency">Performance preset <strong>{preset === "low-latency" ? "Low Latency" : preset === "studio" ? "Studio" : "Balanced"}</strong></div></div><div className="moo-wave" aria-hidden="true">{Array.from({ length: 54 }).map((_, index) => <i key={index} style={{ height: `${8 + ((index * 17) % 28)}px` }} />)}</div></section>

                <section className="moo-grid">
                    <article className="moo-panel" id="moo-models">
                        <div className="moo-panel-heading"><div><span className="moo-icon">◉</span><div><h3>Voice model</h3><p>Choose how you want to sound</p></div></div><div className="moo-panel-actions">{mode === "advanced" && selectedModel?.voiceChangerType === "RVC" && typeof selectedModel.slotIndex === "number" && <button onClick={() => openImporter(selectedModel.slotIndex)}>Replace selected</button>}<button onClick={() => openImporter()}>Import model</button></div></div>
                        {availableModels.length > 0 && <><div className="moo-library-search"><span>⌕</span><input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="Search names, tags, or notes…" />{modelQuery && <button onClick={() => setModelQuery("")} aria-label="Clear model search">×</button>}</div><div className="moo-library-filters"><button className={!modelFavoritesOnly ? "active" : ""} onClick={() => setModelFavoritesOnly(false)}>All voices</button><button className={modelFavoritesOnly ? "active" : ""} onClick={() => setModelFavoritesOnly(true)} disabled={favoriteModelCount === 0}>★ Favorites {favoriteModelCount ? `(${favoriteModelCount})` : ""}</button></div></>}
                        {availableModels.length > 0 ? (
                            visibleModels.length > 0 ? <div className="moo-model-list">
                                {visibleModels.slice(0, 12).map((slot) => {
                                    const metadata = slot.voiceChangerType === "RVC" ? rvcMetadata[rvcPreferenceKey(slot)] || {} : {};
                                    const displayName = metadata.displayName?.trim() || slot.name || `Voice ${slot.slotIndex}`;
                                    return <div key={String(slot.slotIndex)} className={String(slot.slotIndex) === String(server.modelSlotIndex) ? "moo-model-option active" : "moo-model-option"}>
                                        <button className="moo-model-select" disabled={Boolean(profileApplying)} onClick={() => selectModel(slot.slotIndex)}>
                                            <span>{displayName.slice(0, 1).toUpperCase()}</span>
                                            <div><strong>{displayName}</strong><small>{metadata.tags?.trim() || slot.voiceChangerType}{metadata.displayName?.trim() ? ` · ${slot.name}` : ""}</small></div>
                                        </button>
                                        {slot.voiceChangerType === "RVC" && <button className={metadata.favorite ? "moo-model-favorite active" : "moo-model-favorite"} onClick={() => updateRvcMetadata(slot, { favorite: !metadata.favorite })} aria-label={metadata.favorite ? `Remove ${displayName} from favorites` : `Add ${displayName} to favorites`}>{metadata.favorite ? "★" : "☆"}</button>}
                                    </div>;
                                })}
                            </div> : <div className="moo-library-empty">{modelFavoritesOnly ? "No favorite voices match this search." : `No voice models match “${modelQuery}”.`}</div>
                        ) : (
                            <div className="moo-empty" onClick={() => openImporter()}><div className="moo-empty-icon">＋</div><div><strong>No model selected</strong><span>Import an RVC .pth or .onnx model</span></div></div>
                        )}
                        {mode === "advanced" && selectedModel?.voiceChangerType === "RVC" && <div className="moo-model-organizer">
                            <div><span>MODEL DETAILS</span><strong>{selectedModelMetadata.displayName?.trim() || selectedModel.name}</strong></div>
                            <label><span>MY NAME FOR THIS VOICE</span><input value={selectedModelMetadata.displayName || ""} onChange={(event) => updateRvcMetadata(selectedModel, { displayName: event.target.value })} placeholder={String(selectedModel.name || "Voice name")} /></label>
                            <label><span>TAGS</span><input value={selectedModelMetadata.tags || ""} onChange={(event) => updateRvcMetadata(selectedModel, { tags: event.target.value })} placeholder="Soft, feminine, English, narrator…" /></label>
                            <label className="wide"><span>NOTES</span><textarea value={selectedModelMetadata.notes || ""} onChange={(event) => updateRvcMetadata(selectedModel, { notes: event.target.value })} placeholder="What this model sounds like and where it works best…" rows={2} /></label>
                        </div>}
                    </article>

                    <article className="moo-panel" id="moo-audio">
                        <div className="moo-panel-heading"><div><span className="moo-icon">⌁</span><div><h3>Audio route</h3><p>Microphone to converted output</p></div></div><button onClick={testAudio} disabled={audioState === "requesting"}>{audioState === "requesting" ? "Testing…" : "Test audio"}</button></div>
                        <label className="moo-field"><span>MICROPHONE</span><select value={inputId} onChange={(event) => updateInput(event.target.value)}><option value="">System default microphone</option>{inputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
                        <div className="moo-route-line"><i /><i /><i /></div>
                        <label className="moo-field"><span>OUTPUT</span><select value={outputId} onChange={(event) => updateOutput(event.target.value)}><option value="">System default output</option>{outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}</select></label>
                        <div className={`moo-audio-message ${audioState}`}>{audioMessage}</div>
                    </article>
                </section>

                {modelReady && selectedModel?.voiceChangerType === "RVC" && (
                    <section className="moo-transform" aria-label="Voice transformation controls">
                        <div className="moo-section-title">
                            <div><h3>Voice transformation</h3><p>Tune pitch, model similarity, and speech clarity.</p></div>
                            <span>RVC · {selectedModel.name}</span>
                        </div>
                        <div className="moo-profile-row">
                            {(Object.keys(VOICE_PROFILES) as VoiceProfile[]).map((profile) => {
                                const settings = VOICE_PROFILES[profile];
                                const active = activeVoiceProfile === profile;
                                return <button key={profile} className={active ? "active" : ""} aria-pressed={active} disabled={Boolean(profileApplying)} onClick={() => applyVoiceProfile(profile)}>
                                    <span className="moo-profile-check">{active ? "✓ Selected" : "Select"}</span>
                                    <strong>{settings.label}</strong>
                                    <small>{settings.description}</small>
                                </button>;
                            })}
                        </div>
                        <div className={activeVoiceProfile ? "moo-profile-selection active" : "moo-profile-selection"}>
                            <div><span>{profileApplying ? "SYNCING ENGINE" : activeVoiceProfile ? "ACTIVE PROFILE" : "CUSTOM SETTINGS"}</span><strong>{profileApplying || activeProfileSettings?.label || "Custom tuning"}</strong></div>
                            <small>Pitch {displayedTransformation.tran > 0 ? "+" : ""}{displayedTransformation.tran} · Similarity {Math.round(displayedTransformation.indexRatio * 100)}% · Detail {Math.round(displayedTransformation.protect * 100)}% · Remembered for this model</small>
                        </div>
                        {mode === "advanced" && <div className="moo-transform-grid">
                            <label className="moo-slider">
                                <div><span>Pitch shift</span><strong>{displayedTransformation.tran > 0 ? "+" : ""}{displayedTransformation.tran} semitones</strong></div>
                                <input type="range" min="-12" max="12" step="1" value={displayedTransformation.tran} onChange={(event) => updateTransformation({ tran: Number(event.target.value) })} />
                                <small>Lower voice</small><small>Higher voice</small>
                            </label>
                            <label className="moo-slider">
                                <div><span>Model similarity</span><strong>{Math.round(displayedTransformation.indexRatio * 100)}%</strong></div>
                                <input type="range" min="0" max="1" step="0.05" value={displayedTransformation.indexRatio} onChange={(event) => updateTransformation({ indexRatio: Number(event.target.value) })} />
                                <small>Natural features</small><small>More model identity</small>
                            </label>
                            <label className="moo-slider">
                                <div><span>Detail protection</span><strong>{Math.round(displayedTransformation.protect * 100)}%</strong></div>
                                <input type="range" min="0" max="0.5" step="0.01" value={displayedTransformation.protect} onChange={(event) => updateTransformation({ protect: Number(event.target.value) })} />
                                <small>More transformation</small><small>Clearer consonants</small>
                            </label>
                        </div>}
                    </section>
                )}

                {modelReady && isBeatriceJvs && (
                    <section className="moo-transform" aria-label="JVS voice controls">
                        <div className="moo-section-title">
                            <div><h3>JVS voice browser</h3><p>Explore Japanese-trained Beatrice voices and save the ones that work for you.</p></div>
                            <span>Beatrice · JVS</span>
                        </div>
                        <div className="moo-jvs-tools"><button className={!jvsFavoritesOnly ? "active" : ""} onClick={() => setJvsFavoritesOnly(false)}>All 100</button><button className={jvsFavoritesOnly ? "active" : ""} onClick={() => setJvsFavoritesOnly(true)} disabled={jvsFavoriteSpeakerIds.length === 0}>★ Favorites {jvsFavoriteSpeakerIds.length > 0 ? `(${jvsFavoriteSpeakerIds.length})` : ""}</button></div>
                        <div className="moo-jvs-browser">
                            <button onClick={() => stepBeatriceVoice(-1)} aria-label="Previous JVS speaker">‹</button>
                            <div className="moo-jvs-current">
                                <small>JVS SPEAKER</small>
                                <strong>{jvsAliases[String(guiState.beatriceJVSSpeakerId)] || `JVS ${String(guiState.beatriceJVSSpeakerId).padStart(3, "0")}`}</strong>
                                <span>Official ID: jvs{String(guiState.beatriceJVSSpeakerId).padStart(3, "0")}</span>
                            </div>
                            <button onClick={() => stepBeatriceVoice(1)} aria-label="Next JVS speaker">›</button>
                            <button className={jvsFavorites.includes(jvsFavoriteKey(guiState.beatriceJVSSpeakerId, guiState.beatriceJVSSpeakerPitch)) ? "moo-jvs-favorite active" : "moo-jvs-favorite"} onClick={toggleJvsFavorite} aria-label="Favorite this voice and range">{jvsFavorites.includes(jvsFavoriteKey(guiState.beatriceJVSSpeakerId, guiState.beatriceJVSSpeakerPitch)) ? "★ Saved" : "☆ Save"}</button>
                        </div>
                        <div className={mode === "advanced" ? "moo-transform-grid" : "moo-transform-grid simple-jvs"}>
                            {mode === "advanced" && <label className="moo-field">
                                <span>JVS SPEAKER</span>
                                <select value={guiState.beatriceJVSSpeakerId} onChange={(event) => updateBeatriceVoice(Number(event.target.value), guiState.beatriceJVSSpeakerPitch)}>
                                    {jvsBrowseIds.map((id) => {
                                        const alias = jvsAliases[String(id)];
                                        const favorite = jvsFavorites.some((item) => item.startsWith(`${id}:`)) ? "★ " : "";
                                        return <option key={id} value={id}>{favorite}{alias || `JVS ${String(id).padStart(3, "0")}`}</option>;
                                    })}
                                </select>
                            </label>}
                            <label className="moo-field">
                                <span>VOICE RANGE</span>
                                <select value={guiState.beatriceJVSSpeakerPitch} onChange={(event) => updateBeatriceVoice(guiState.beatriceJVSSpeakerId, Number(event.target.value))}>
                                    <option value={-2}>Much lower</option>
                                    <option value={-1}>Lower</option>
                                    <option value={0}>Natural</option>
                                    <option value={1}>Higher</option>
                                    <option value={2}>Much higher</option>
                                </select>
                            </label>
                            {mode === "advanced" && <label className="moo-field">
                                <span>MY NAME FOR THIS VOICE</span>
                                <input value={jvsAliases[String(guiState.beatriceJVSSpeakerId)] || ""} onChange={(event) => updateJvsAlias(event.target.value)} placeholder="Example: Soft, Bright, Narrator…" />
                            </label>}
                        </div>
                        {jvsFavorites.length > 0 && <div className="moo-jvs-saved"><strong>Saved voices</strong>{jvsFavorites.map((item) => { const [speakerValue, pitchValue] = item.split(":").map(Number); const active = speakerValue === guiState.beatriceJVSSpeakerId && pitchValue === guiState.beatriceJVSSpeakerPitch; return <button key={item} className={active ? "active" : ""} onClick={() => updateBeatriceVoice(speakerValue, pitchValue)}><span>{jvsAliases[String(speakerValue)] || `JVS ${String(speakerValue).padStart(3, "0")}`}</span><small>{JVS_RANGE_LABELS[pitchValue]}</small></button>; })}</div>}
                        <div className="moo-import-note"><strong>Japanese-trained</strong><span>English may inherit Japanese pronunciation and rhythm. These voices are best treated as experimental styles, not natural English models.</span></div>
                    </section>
                )}

                {modelReady && (
                    <section className="moo-audition" aria-label="Voice audition recorder">
                        <div className="moo-section-title">
                            <div><h3>Audition comparison</h3><p>Record the converted output and compare voices using the same test phrase.</p></div>
                            {auditionClips.length > 0 && <button onClick={clearAuditionClips}>Clear clips</button>}
                        </div>
                        <div className="moo-audition-capture">
                            <div><small>TEST PHRASE</small><strong>“Hey, how’s it going? I’m testing my new voice today.”</strong><span>{auditionRecording ? "Recording converted output now…" : "Start conversion, press record, then read the phrase."}</span></div>
                            <button className={auditionRecording ? "recording" : ""} onClick={auditionRecording ? stopAuditionRecording : startAuditionRecording}>{auditionRecording ? "■ Stop sample" : "● Record sample"}</button>
                        </div>
                        {auditionError && <div className="moo-import-error">{auditionError}</div>}
                        {auditionClips.length > 0 && <div className="moo-audition-clips">{auditionClips.map((clip) => <article key={clip.id}>
                            <div className="moo-audition-identity"><small>SAMPLE {String(clip.sampleNumber).padStart(2, "0")} · {clip.createdAt}</small><strong>{clip.label}</strong><span>{clip.detail}</span></div>
                            <audio controls src={clip.url} />
                            <a href={clip.url} download={clip.filename} title={clip.filename}>↓ WAV</a>
                            <button onClick={() => removeAuditionClip(clip.id)} aria-label={`Remove sample ${clip.sampleNumber}, ${clip.label}`}>×</button>
                        </article>)}</div>}
                    </section>
                )}

                <section className="moo-performance" id="moo-performance">
                    <div className="moo-section-title"><div><h3>Performance preset</h3><p>{presetBusy ? "Applying engine settings…" : "Choose a tuned starting point for your workload."}</p></div>{mode === "advanced" && engineConnected && server.gpus?.length ? <label className="moo-gpu-select"><span>COMPUTE</span><select value={server.gpu} onChange={(event) => selectGpu(Number(event.target.value))}>{server.gpus.map((gpu) => <option key={gpu.id} value={gpu.id}>{gpu.name}</option>)}<option value={-1}>CPU</option></select></label> : mode === "advanced" ? <span>Connect engine to detect hardware</span> : <span>Auto-tuned for your hardware</span>}</div>
                    <div className="moo-preset-grid">{[["low-latency","Low Latency","Fastest response for live chat","Discord · Game chat"],["balanced","Balanced","The best starting point","Everyday use"],["studio","Studio","Prioritize sound quality","Recording · Production"]].map(([id,title,copy,meta]) => <button key={id} className={preset === id ? "moo-preset active" : "moo-preset"} onClick={() => applyPreset(id as Preset)} disabled={presetBusy}><span className="moo-radio" /><strong>{title}</strong><small>{copy}</small><em>{meta}</em></button>)}</div>
                </section>

                {mode === "advanced" && <section className="moo-advanced"><div><span>Chunk size</span><strong>{appState.setting.workletNodeSetting.inputChunkNum}</strong></div><div><span>Pitch detector</span><strong>{server.f0Detector}</strong></div><div><span>Feature index influence</span><strong>{server.indexRatio}</strong></div><div><span>Protect</span><strong>{server.protect}</strong></div><div><span>Compute device</span><strong>{computeLabel}</strong></div><div><span>Extra buffer</span><strong>{server.extraConvertSize}</strong></div></section>}

                {mode === "advanced" && <section className="moo-legacy-gate"><div><strong>Engine compatibility controls</strong><span>Use the original interface for controls MooVoice has not modernized yet.</span></div><button onClick={() => setLegacyVisible((value) => !value)}>{legacyVisible ? "Hide legacy interface" : "Open legacy interface"}</button></section>}
                {mode === "advanced" && legacyVisible && <div className="moo-legacy"><ModelSlotControl /></div>}
                {importOpen && (
                    <div className="moo-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !appState.serverSetting.isUploading) setImportOpen(false); }}>
                        <section className="moo-import-modal" role="dialog" aria-modal="true" aria-labelledby="moo-import-title">
                            <div className="moo-import-header">
                                <div><span>VOICE LIBRARY</span><h2 id="moo-import-title">{importReplacing ? "Replace selected RVC model" : "Import an RVC model"}</h2><p>{importReplacing ? `Update slot ${importSlot} while keeping it in the same library position.` : "Add a model you own or have permission to use."}</p></div>
                                <button onClick={() => setImportOpen(false)} disabled={appState.serverSetting.isUploading} aria-label="Close">×</button>
                            </div>
                            <label className="moo-import-name"><span>VOICE NAME</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="My voice model" /></label>
                            <div className="moo-file-grid">
                                <label className={importModel ? "moo-file-drop selected" : "moo-file-drop"}>
                                    <input type="file" accept=".pth,.onnx" onChange={(event) => chooseModelFile(event.target.files?.[0] || null)} />
                                    <b>{importModel ? "✓" : "+"}</b><strong>RVC model</strong><span>{importModel ? `${importModel.name} · ${formatFileSize(importModel.size)}` : ".pth or .onnx · required"}</span>
                                </label>
                                <label className={importIndex ? "moo-file-drop selected" : "moo-file-drop"}>
                                    <input type="file" accept=".index,.bin" onChange={(event) => chooseIndexFile(event.target.files?.[0] || null)} />
                                    <b>{importIndex ? "✓" : "+"}</b><strong>Feature index</strong><span>{importIndex ? `${importIndex.name} · ${formatFileSize(importIndex.size)}` : ".index or .bin · recommended"}</span>
                                </label>
                            </div>
                            <div className={importReplacing ? "moo-import-note warning" : "moo-import-note"}><strong>Slot {importSlot}</strong><span>{importReplacing ? "This overwrites the model currently stored in this slot. The previous model files will no longer be selected by MooVoice." : "Compatibility does not guarantee voice quality. Use the matching index and a well-trained, properly licensed RVC model for the best result."}</span></div>
                            {importError && <div className="moo-import-error">{importError}</div>}
                            {appState.serverSetting.isUploading && <div className="moo-upload-progress"><i style={{ width: `${Math.max(2, appState.serverSetting.uploadProgress)}%` }} /><span>{appState.serverSetting.uploadProgress > 0 ? `Uploading ${appState.serverSetting.uploadProgress.toFixed(0)}%` : "Loading model into the engine…"}</span></div>}
                            <div className="moo-import-actions"><button onClick={() => setImportOpen(false)} disabled={appState.serverSetting.isUploading}>Cancel</button><button className="primary" onClick={importRvcModel} disabled={appState.serverSetting.isUploading || !importModel}>{appState.serverSetting.isUploading ? (importReplacing ? "Replacing…" : "Importing…") : (importReplacing ? "Replace model" : "Import voice")}</button></div>
                        </section>
                    </div>
                )}
                <audio hidden id="moovoice-audio-output" autoPlay playsInline />
                <audio hidden id="moovoice-audio-monitor" muted />
            </main>
        </div>
    );
};
