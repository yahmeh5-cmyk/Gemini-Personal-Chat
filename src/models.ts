export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  fileInfo?: FileMetadata;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

export interface FileMetadata {
  name: string;
  size: number; // in bytes
  type: string;
  wordCount: number;
  charCount: number;
  base64Content?: string;
  pageCount?: number;
}