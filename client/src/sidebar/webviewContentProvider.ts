import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class WebviewContentProvider {
    private context: vscode.ExtensionContext;
    private htmlContent: string | null = null;
    private cssContent: string | null = null;
    private jsContent: string | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getWebviewContent(webview: vscode.Webview): string {
        // Load the HTML content if not already loaded
        if (!this.htmlContent) {
            this.loadContents();
        }

        // Return the HTML content
        return this.getHtmlForWebview(webview);
    }

    private loadContents() {
        // Get the path to the media folder
        const mediaPath = path.join(this.context.extensionPath, 'media');
        
        // Load files from disk
        this.htmlContent = fs.readFileSync(path.join(mediaPath, 'index.html'), 'utf8');
        this.cssContent = fs.readFileSync(path.join(mediaPath, 'styles.css'), 'utf8');
        this.jsContent = fs.readFileSync(path.join(mediaPath, 'main.js'), 'utf8');
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const mediaPath = path.join(this.context.extensionPath, 'media');
        
        // Carregar os arquivos
        const htmlContent = fs.readFileSync(path.join(mediaPath, 'index.html'), 'utf8');
        const cssContent = fs.readFileSync(path.join(mediaPath, 'styles.css'), 'utf8');
        const jsContent = fs.readFileSync(path.join(mediaPath, 'main.js'), 'utf8');
        
        // Gerar nonce para segurança
        const nonce = this.getNonce();


        // Substituir o <link> e <script> por conteúdo inline
        let html = htmlContent
            .replace('<link rel="stylesheet" href="{{styleUri}}">', `<style>${cssContent}</style>`)
            .replace(
                '<script src="{{scriptUri}}"></script>',
                `<script nonce="${nonce}">${jsContent}</script>`
            )
            .replace('{{cspNonce}}', nonce);
        
        return html;
    }
    
    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}