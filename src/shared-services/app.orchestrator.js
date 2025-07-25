// shared-services/app.orchestrator.js
import { ConfigManager } from './config.manager.js';
import { LiveTracker } from '../services/normalizer.main.js';
import { aiPromptRenewer } from '../services/aiPromptRenewer.js';
import { UIManager } from '../ui-components/ui.manager.js';
import { state } from './state.manager.js';

export class AppOrchestrator {
    constructor() {
        this.configManager = new ConfigManager();
        this.tracker = new LiveTracker();
        this.ui = new UIManager();
        this.aiPromptRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
        this.configLoaded = false;
        
        // Add this line for easy debugging
        window.state = state;
    }

    async init() {
        this.ui.init();
        this.setupEvents();
        await this.reloadConfig();
        this.configLoaded = true;
    }

    setupEvents() {
        // Existing events
        document.getElementById('renew-prompt')?.addEventListener('click', () => this.renewPrompt());
        document.getElementById('load-config')?.addEventListener('click', e => {
            e.preventDefault();
            this.ui.showView('config');
            if (!this.configLoaded) this.reloadConfig();
        });
    }

    async reloadConfig() {
        try {
            await this.configManager.loadConfig();
            // Store config in state for direct UI access
            const config = this.configManager.getConfig();
            state.setConfig(config);
            
            if (!this.configLoaded) await this.ui.reloadMappingModules();

            state.setStatus("Config reloaded");
        } catch (error) {
            state.setStatus(`Config failed: ${error.message}`, true);
        }
    }

    async renewPrompt() {
        const config = this.configManager.getConfig();
        if (!config) {
            state.setStatus("Config not loaded", true);
            return;
        }

        const button = document.getElementById('renew-prompt');
        const label = button?.querySelector('.ms-Button-label');
        const originalText = label?.textContent || 'Renew Prompt 🤖';
        let cancelled = false;

        const cancelHandler = () => {
            cancelled = true;
            state.setStatus("Generation cancelled");
        };

        if (button) {
            button.removeEventListener('click', this.renewPrompt);
            button.addEventListener('click', cancelHandler);
        }
        if (label) label.textContent = 'Cancel Generation';

        try {
            const mappings = state.get('mappings');
            await this.aiPromptRenewer.renewPrompt(mappings, config, () => cancelled);
        } finally {
            if (button) {
                button.removeEventListener('click', cancelHandler);
                button.addEventListener('click', () => this.renewPrompt());
            }
            if (label) label.textContent = originalText;
        }
    }

}