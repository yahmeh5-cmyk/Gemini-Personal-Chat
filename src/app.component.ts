import { Component, ChangeDetectionStrategy, signal, computed, inject, WritableSignal, effect, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from './services/gemini.service';
import { ChatSession, ChatMessage, FileMetadata } from './models';
import { Content } from '@google/genai';
import { MarkdownPipe } from './pipes/markdown.pipe';
import * as pdfjsLib from 'pdfjs-dist';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, MarkdownPipe],
})
export class AppComponent {
  private geminiService = inject(GeminiService);

  // State Signals
  chatSessions: WritableSignal<ChatSession[]> = signal([]);
  activeSessionId: WritableSignal<string | null> = signal(null);
  isLoading = signal(false);
  currentPrompt = signal('');
  attachedFile = signal<File | null>(null);
  fileMetadata = signal<FileMetadata | null>(null);
  error = signal<string | null>(null);

  chatContainer = viewChild<ElementRef>('chatContainer');

  // Computed Signals
  activeSession = computed(() => {
    const id = this.activeSessionId();
    if (!id) return null;
    return this.chatSessions().find(s => s.id === id) ?? null;
  });
  
  constructor() {
    // Set worker source for pdf.js. Using a CDN for the worker.
    // The version MUST match the version of 'pdfjs-dist' in the importmap.
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://next.esm.sh/pdfjs-dist@5.4.149/build/pdf.worker.mjs`;

    // Auto-scroll effect
    effect(() => {
      if (this.activeSession()?.messages) {
        this.scrollToBottom();
      }
    });
  }

  startNewChat(): void {
    const newSession: ChatSession = {
      id: `chat_${Date.now()}`,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    this.chatSessions.update(sessions => [newSession, ...sessions]);
    this.activeSessionId.set(newSession.id);
    this.resetInput();
  }

  selectChat(id: string): void {
    this.activeSessionId.set(id);
  }

  deleteChat(id: string): void {
    this.chatSessions.update(s => s.filter(session => session.id !== id));
    if (this.activeSessionId() === id) {
      this.activeSessionId.set(this.chatSessions()[0]?.id ?? null);
    }
  }

  async handleFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

    if (file.size > MAX_FILE_SIZE) {
        this.error.set(`File is too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
        this.attachedFile.set(null);
        input.value = ''; // Reset file input
        return;
    }

    this.attachedFile.set(file);
    this.error.set(null);
    await this.processFile(file);
    input.value = ''; // Reset file input to allow re-selection of the same file
  }

  private async processFile(file: File): Promise<void> {
    const base64Content = await this.fileToBase64(file);
    let wordCount = 0;
    let charCount = 0;
    let pageCount: number | undefined;

    if (file.type.startsWith('text/')) {
      const textContent = await file.text();
      charCount = textContent.length;
      wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
    } else if (file.type === 'application/pdf') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        pageCount = pdf.numPages;
      } catch (e) {
        console.error('Error processing PDF file:', e);
        this.error.set('Could not read page count from the PDF file.');
      }
    }

    this.fileMetadata.set({
      name: file.name,
      size: file.size,
      type: file.type,
      wordCount,
      charCount,
      base64Content,
      pageCount,
    });
  }
  
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  }

  removeAttachment(): void {
    this.attachedFile.set(null);
    this.fileMetadata.set(null);
  }

  async sendMessage(): Promise<void> {
    const prompt = this.currentPrompt().trim();
    const fileMeta = this.fileMetadata();
    if (!prompt && !fileMeta) return;

    this.isLoading.set(true);
    this.error.set(null);

    let currentSession = this.activeSession();
    if (!currentSession) {
      this.startNewChat();
      currentSession = this.activeSession();
      if (!currentSession) { // Should not happen
        this.error.set("Could not create or find a chat session.");
        this.isLoading.set(false);
        return;
      }
    }
    
    const userMessage: ChatMessage = { role: 'user', text: prompt };
    if (fileMeta) {
      userMessage.fileInfo = { ...fileMeta }; // Add file info to message
    }

    // Update session title for the first message
    if (currentSession.messages.length === 0) {
      currentSession.title = prompt.substring(0, 30) || fileMeta?.name || 'New Conversation';
    }
    currentSession.messages.push(userMessage);
    
    const aiMessage: ChatMessage = { role: 'ai', text: '' };
    currentSession.messages.push(aiMessage);
    
    this.chatSessions.update(sessions => 
      sessions.map(s => s.id === currentSession?.id ? currentSession! : s)
    );
    
    this.resetInput();

    try {
      const history = this.buildHistory(currentSession.messages);
      const stream = await this.geminiService.generateContentStream(history, prompt, fileMeta);
      
      for await (const chunk of stream) {
        aiMessage.text += chunk.text;
        this.chatSessions.update(sessions => 
          sessions.map(s => s.id === currentSession?.id ? currentSession! : s)
        );
        this.scrollToBottom();
      }
    } catch (e: any) {
      console.error(e);
      this.error.set('An error occurred while communicating with the AI. Please check your setup and try again.');
      aiMessage.text = 'Sorry, I encountered an error. Please try again.';
    } finally {
      this.isLoading.set(false);
    }
  }

  private buildHistory(messages: ChatMessage[]): Content[] {
    // FIX: Correctly build history with file data for multi-turn conversations.
    // The previous implementation only sent text, losing file context in follow-up messages.
    // Take all but the last two messages (the user's new prompt and the AI's empty placeholder)
    return messages.slice(0, -2).map(msg => {
      const parts: any[] = [{ text: msg.text }];

      if (msg.role === 'user' && msg.fileInfo && msg.fileInfo.base64Content) {
        parts.unshift({
          inlineData: {
            mimeType: msg.fileInfo.type,
            data: msg.fileInfo.base64Content,
          },
        });
      }
      
      return {
        role: msg.role === 'ai' ? 'model' : 'user',
        parts: parts,
      };
    });
  }

  private resetInput(): void {
    this.currentPrompt.set('');
    this.removeAttachment();
  }

  private scrollToBottom(): void {
    try {
      if (this.chatContainer()) {
        const element = this.chatContainer()!.nativeElement;
        setTimeout(() => { element.scrollTop = element.scrollHeight; }, 0);
      }
    } catch (err) {
      console.error('Could not scroll to bottom:', err);
    }
  }
  
  formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  trackBySessionId(index: number, session: ChatSession): string {
    return session.id;
  }

  trackByMessage(index: number, message: ChatMessage): number {
    return index;
  }
}