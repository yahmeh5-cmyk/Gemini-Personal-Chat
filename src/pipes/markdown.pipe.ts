import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Using a robust third-party library to parse markdown.
// This is a common practice to handle complex markdown structures like code blocks, lists, etc.
// In a typical project, you would install this with 'npm install marked @types/marked'.
// We assume 'marked' is available in this environment, similar to 'pdfjs-dist'.
import { marked } from 'marked';

@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  constructor() {
    // Configure marked to handle newlines as <br> elements, which is common for chat interfaces.
    // Also, enable gfm for tables etc.
    marked.setOptions({
        gfm: true,
        breaks: true,
        pedantic: false,
    });
  }

  transform(value: string | null | undefined): SafeHtml {
    if (value === null || value === undefined || value.trim() === '') {
      return '';
    }

    try {
        const rawHtml = marked.parse(value) as string;
        // Sanitize the HTML to prevent XSS attacks before rendering.
        return this.sanitizer.bypassSecurityTrustHtml(rawHtml);
    } catch (e) {
        console.error('Error parsing markdown:', e);
        // In case of an error, return an empty string to avoid rendering broken content.
        return '';
    }
  }
}
