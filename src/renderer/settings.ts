interface ElectronAPI {
    dictionaryGet: () => Promise<any>;
    dictionaryAddWord: (word: string) => Promise<void>;
    dictionaryRemoveWord: (word: string) => Promise<void>;
    dictionaryAddCorrection: (wrong: string, correct: string) => Promise<void>;
    snippetsGet: () => Promise<any[]>;
    snippetsAdd: (trigger: string, expansion: string, desc?: string) => Promise<void>;
    snippetsUpdate: (id: string, updates: any) => Promise<void>;
    snippetsRemove: (id: string) => Promise<void>;
    stylesGet: () => Promise<Record<string, any>>;
    stylesSet: (appName: string, style: any) => Promise<void>;
    stylesRemove: (appName: string) => Promise<void>;
    processingGetOptions: () => Promise<any>;
    processingSetOptions: (opts: any) => Promise<void>;
    getActiveAppInfo?: () => Promise<{ name: string; iconDataUrl?: string }>;
}

interface Window {
    electronAPI: ElectronAPI;
}

class SettingsUI {
    constructor() {
        this.init();
    }

    private init(): void {
        this.setupTabs();
        this.loadData();
        this.setupEventListeners();
    }

    private setupTabs(): void {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.getAttribute('data-tab');
                document.getElementById(`tab-${tabId}`)?.classList.add('active');
            });
        });
    }

    private async loadData(): Promise<void> {
        await this.loadDictionary();
        await this.loadSnippets();
        await this.loadStyles();
        await this.loadProcessingOptions();
    }

    private setupEventListeners(): void {
        document.getElementById('add-word-btn')?.addEventListener('click', () => this.addWord());
        document.getElementById('add-correction-btn')?.addEventListener('click', () => this.addCorrection());
        document.getElementById('add-snippet-btn')?.addEventListener('click', () => this.addSnippet());
        document.getElementById('add-style-btn')?.addEventListener('click', () => this.addStyle());

        // Wire up toggle buttons
        document.querySelectorAll('.toggle[data-toggle-for]').forEach(btn => {
            btn.addEventListener('click', () => this.handleToggleClick(btn as HTMLElement));
        });

        // Setup event delegation for delete buttons
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const deleteBtn = target.closest('.delete-btn') as HTMLElement;
            if (deleteBtn) {
                const wordDelete = deleteBtn.getAttribute('data-word');
                const snippetDelete = deleteBtn.getAttribute('data-id');
                const styleDelete = deleteBtn.getAttribute('data-app');
                
                e.preventDefault();
                
                if (wordDelete) {
                    this.removeWord(wordDelete);
                } else if (snippetDelete) {
                    this.removeSnippet(snippetDelete);
                } else if (styleDelete) {
                    this.removeStyle(styleDelete);
                }
            }
        });
    }

    private handleToggleClick(btn: HTMLElement): void {
        const checkboxId = btn.getAttribute('data-toggle-for');
        if (!checkboxId) return;
        const checkbox = document.getElementById(checkboxId) as HTMLInputElement;
        if (!checkbox) return;

        // Flip state
        checkbox.checked = !checkbox.checked;
        btn.setAttribute('data-state', checkbox.checked ? 'on' : 'off');

        // Map checkbox IDs to processing option keys
        const optionMap: Record<string, string> = {
            'remove-filler': 'removeFiller',
            'auto-punctuation': 'autoPunctuation',
            'format-lists': 'formatLists'
        };

        const optionKey = optionMap[checkboxId];
        if (optionKey) {
            (window as any).electronAPI.processingSetOptions({ [optionKey]: checkbox.checked });
        }
    }

    private async loadProcessingOptions(): Promise<void> {
        const options = await (window as any).electronAPI.processingGetOptions();

        this.setToggleState('remove-filler', options.removeFiller);
        this.setToggleState('auto-punctuation', options.autoPunctuation);
        this.setToggleState('format-lists', options.formatLists);
    }

    private setToggleState(checkboxId: string, enabled: boolean): void {
        const checkbox = document.getElementById(checkboxId) as HTMLInputElement;
        const btn = document.querySelector(`.toggle[data-toggle-for="${checkboxId}"]`) as HTMLElement;
        if (checkbox) {
            checkbox.checked = enabled;
        }
        if (btn) {
            btn.setAttribute('data-state', enabled ? 'on' : 'off');
        }
    }

    private async loadDictionary(): Promise<void> {
        const data = await (window as any).electronAPI.dictionaryGet();
        this.renderWordList(data.customWords || []);
        this.renderCorrectionList(data.corrections || {});
    }

    private renderWordList(words: string[]): void {
        const container = document.getElementById('word-list');
        if (!container) return;

        if (words.length === 0) {
            container.innerHTML = '<div class="empty-state">No custom words added</div>';
            return;
        }

        container.innerHTML = words.map(word => `
      <div class="list-item">
        <div class="content">
          <div class="label">${word}</div>
        </div>
        <button class="delete-btn" data-word="${word}">Remove</button>
      </div>
    `).join('');
    }

    private renderCorrectionList(corrections: Record<string, string>): void {
        const container = document.getElementById('correction-list');
        if (!container) return;

        const entries = Object.entries(corrections);
        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state">No corrections added</div>';
            return;
        }

        container.innerHTML = entries.map(([wrong, correct]) => `
      <div class="list-item">
        <div class="content">
          <div class="label">${wrong} → ${correct}</div>
        </div>
      </div>
    `).join('');
    }

    private async addWord(): Promise<void> {
        const input = document.getElementById('new-word') as HTMLInputElement;
        const word = input.value.trim();
        if (!word) return;

        await (window as any).electronAPI.dictionaryAddWord(word);
        input.value = '';
        await this.loadDictionary();
    }

    async removeWord(word: string): Promise<void> {
        await (window as any).electronAPI.dictionaryRemoveWord(word);
        await this.loadDictionary();
    }

    private async addCorrection(): Promise<void> {
        const wrongInput = document.getElementById('wrong-word') as HTMLInputElement;
        const correctInput = document.getElementById('correct-word') as HTMLInputElement;
        const wrong = wrongInput.value.trim();
        const correct = correctInput.value.trim();
        if (!wrong || !correct) return;

        await (window as any).electronAPI.dictionaryAddCorrection(wrong, correct);
        wrongInput.value = '';
        correctInput.value = '';
        await this.loadDictionary();
    }

    private async loadSnippets(): Promise<void> {
        const snippets = await (window as any).electronAPI.snippetsGet();
        this.renderSnippetList(snippets);
    }

    private renderSnippetList(snippets: any[]): void {
        const container = document.getElementById('snippet-list');
        if (!container) return;

        if (snippets.length === 0) {
            container.innerHTML = '<div class="empty-state">No snippets created</div>';
            return;
        }

        container.innerHTML = snippets.map(s => `
      <div class="list-item">
        <div class="content">
          <div class="label">"${s.trigger}"</div>
          <div class="sublabel">${s.expansion.substring(0, 50)}${s.expansion.length > 50 ? '...' : ''}</div>
        </div>
        <button class="delete-btn" data-id="${s.id}">Remove</button>
      </div>
    `).join('');
    }

    private async addSnippet(): Promise<void> {
        const triggerInput = document.getElementById('snippet-trigger') as HTMLInputElement;
        const expansionInput = document.getElementById('snippet-expansion') as HTMLTextAreaElement;
        const trigger = triggerInput.value.trim();
        const expansion = expansionInput.value.trim();
        if (!trigger || !expansion) return;

        await (window as any).electronAPI.snippetsAdd(trigger, expansion);
        triggerInput.value = '';
        expansionInput.value = '';
        await this.loadSnippets();
    }

    async removeSnippet(id: string): Promise<void> {
        await (window as any).electronAPI.snippetsRemove(id);
        await this.loadSnippets();
    }

    private async loadStyles(): Promise<void> {
        const styles = await (window as any).electronAPI.stylesGet();
        this.renderStyleList(styles);
    }

    private renderStyleList(styles: Record<string, any>): void {
        const container = document.getElementById('style-list');
        if (!container) return;

        const entries = Object.entries(styles);
        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state">No custom styles configured</div>';
            return;
        }

        container.innerHTML = entries.map(([app, style]) => `
      <div class="list-item">
        <div class="content">
          <div class="label">${app}</div>
          <div class="sublabel">Mode: ${style.mode}</div>
        </div>
        <button class="delete-btn" data-app="${app}">Remove</button>
      </div>
    `).join('');
    }

    private async addStyle(): Promise<void> {
        const appInput = document.getElementById('app-name') as HTMLInputElement;
        const modeSelect = document.getElementById('style-mode') as HTMLSelectElement;
        const appName = appInput.value.trim();
        const mode = modeSelect.value;
        if (!appName) return;

        await (window as any).electronAPI.stylesSet(appName, { mode });
        appInput.value = '';
        await this.loadStyles();
    }

    async removeStyle(appName: string): Promise<void> {
        await (window as any).electronAPI.stylesRemove(appName);
        await this.loadStyles();
    }
}

let settings: SettingsUI;
document.addEventListener('DOMContentLoaded', () => {
    settings = new SettingsUI();
});