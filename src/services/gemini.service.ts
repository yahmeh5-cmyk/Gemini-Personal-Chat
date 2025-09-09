
import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, GenerateContentResponse, Content } from '@google/genai';
import { FileMetadata } from '../models';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private genAI: GoogleGenAI;

  constructor() {
    // IMPORTANT: The API key is sourced from environment variables.
    // Do not expose this key in the frontend code in a real application.
    // The Applet environment securely provides `process.env.API_KEY`.
    if (!process.env.API_KEY) {
      throw new Error("API_KEY environment variable not set.");
    }
    this.genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async generateContentStream(
    history: Content[],
    prompt: string,
    file?: FileMetadata
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const model = this.genAI.models;
    const parts: any[] = [{ text: prompt }];

    if (file && file.base64Content) {
      parts.unshift({
        inlineData: {
          mimeType: file.type,
          data: file.base64Content,
        },
      });
    }

    const contents: Content[] = [...history, { role: 'user', parts }];
    
    // The model name is updated as per the instructions
    return model.generateContentStream({
        model: 'gemini-2.5-flash',
        contents,
    });
  }
}
