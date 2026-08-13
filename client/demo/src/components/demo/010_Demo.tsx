import React from "react";
import { GuiStateProvider } from "./001_GuiStateProvider";
import { Dialogs } from "./900_Dialogs";
import { Dialogs2 } from "./910_Dialogs2";
import { MooVoiceShell } from "./MooVoiceShell";
import "../../css/MooVoice.css";

export const Demo = () => {
    return (
        <GuiStateProvider>
            <div className="main-body">
                <Dialogs2 />
                <Dialogs />
                <MooVoiceShell />
            </div>
        </GuiStateProvider>
    );
};
