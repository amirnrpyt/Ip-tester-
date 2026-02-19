import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleGenAI } from "@google/genai";

interface ParsedResult {
  ip: string;
  port: string;
  type: 'IPv4' | 'IPv6' | 'Domain';
}

interface CsvRow {
  ip: string;
  port: string;
  country: string;
  raw: string; 
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: []
})
export class AppComponent {
  // --- Input State ---
  inputText = signal('');
  fileName = signal<string | null>(null);
  aiPrompt = signal(''); // User custom instruction for AI

  // --- Processed State ---
  processedContent = signal(''); 
  isAiLoading = signal(false);
  
  // --- UI State ---
  copiedField = signal<string | null>(null);
  selectedCountry = signal<string>('ALL');
  hidePort = signal(false);
  
  // --- Computed Parsing Logic ---
  parsedRows = computed(() => {
    const content = this.processedContent();
    if (!content.trim()) return [];

    const lines = content.split(/\r?\n/);
    const result: CsvRow[] = [];

    // Regex to find IPv4 with optional port
    // Captures: Group 1 (IP), Group 2 (Port - Optional)
    // Matches: 192.168.1.1 or 192.168.1.1:8080
    const ipPortRegex = /\b((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))(?::(\d{1,5}))?\b/g;

    for (const line of lines) {
      if (!line.trim()) continue;

      // 1. Find all IPs in the current line (supports multiple IPs per line/json/messy text)
      const matches = [...line.matchAll(ipPortRegex)];
      
      if (matches.length === 0) continue;

      // 2. Identify a potential country code for this line
      // Heuristic: Look for 2 uppercase letters that are likely Country Codes
      const tokens = line.split(/[^A-Za-z0-9]/).filter(t => t);
      let lineCountry = 'Unknown';
      
      for(const t of tokens) {
         // Strict uppercase check to avoid words like "it", "is", "us" (if lowercase)
         // Filter out common protocol/status keywords that look like countries
         if (/^[A-Z]{2}$/.test(t) && !['OK', 'UP', 'IP', 'TCP', 'UDP', 'HTTP', 'ID'].includes(t)) {
             lineCountry = t;
             break; // Use the first found country code for the line
         }
      }

      for (const match of matches) {
        const ip = match[1];
        let port = match[2] || '';
        
        // 3. Fallback Port Detection
        // If regex didn't catch an attached port (e.g. "1.1.1.1 8080" space separated), 
        // look for loose port numbers if there is only one IP in the line (to avoid matching wrong port to wrong IP)
        if (!port && matches.length === 1) {
             const potentialPorts = line.match(/\b\d{2,5}\b/g);
             if (potentialPorts) {
                 for(const p of potentialPorts) {
                     // Ensure p is not part of the IP octets
                     if (!ip.includes(p)) {
                         const pNum = parseInt(p, 10);
                         if (pNum > 0 && pNum <= 65535) {
                             port = p;
                             break;
                         }
                     }
                 }
             }
        }

        result.push({
            ip,
            port, // might be empty string
            country: lineCountry,
            raw: line
        });
      }
    }
    
    return result.sort((a, b) => a.country.localeCompare(b.country));
  });

  availableCountries = computed(() => {
    const rows = this.parsedRows();
    const countries = new Set<string>();
    rows.forEach(r => countries.add(r.country));
    return Array.from(countries).sort();
  });

  finalOutput = computed(() => {
    const country = this.selectedCountry();
    const hidePort = this.hidePort();
    let rows = this.parsedRows();

    if (country !== 'ALL') {
      rows = rows.filter(r => r.country === country);
    }

    if (rows.length === 0) return '';
    
    return rows.map(r => {
      // If port exists, append it. If not, just IP.
      const portSuffix = (r.port && !hidePort) ? `:${r.port}` : '';
      return `${r.ip}${portSuffix}`;
    }).join('\n');
  });

  stats = computed(() => {
    const allRows = this.parsedRows();
    const total = allRows.length;
    const filteredCount = this.selectedCountry() === 'ALL' 
      ? total 
      : allRows.filter(r => r.country === this.selectedCountry()).length;
    
    return { total, filteredCount };
  });

  // --- Actions ---

  processInput() {
    if (!this.inputText().trim()) return;
    this.processedContent.set(this.inputText());
    this.selectedCountry.set('ALL');
  }

  async processWithAi() {
    const text = this.inputText().trim();
    if (!text) return;

    this.isAiLoading.set(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env['API_KEY'] });
      
      const customInstruction = this.aiPrompt().trim();
      const prompt = `
      Act as a strict network data extraction tool.
      
      Task:
      1. Extract all valid IP addresses (IPv4/IPv6) and their ports from the text below.
      2. Identify the 2-letter Country Code (ISO 3166-1 alpha-2) if present. If not found, use 'Unknown'.
      3. Format the output strictly as CSV: IP,Port,Country
      
      Constraints:
      - Do not include any markdown formatting (no \`\`\`).
      - Do not include headers.
      - Remove duplicates.
      - Ignore lines that do not contain valid IPs.
      
      ${customInstruction ? `USER INSTRUCTION (Apply this filter/logic): ${customInstruction}` : ''}
      
      Input Text:
      ${text.substring(0, 30000)}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      let result = response.text || '';
      // Clean up any potential markdown code blocks
      result = result.replace(/^```csv/i, '').replace(/^```/gm, '').trim();

      this.processedContent.set(result);
      this.selectedCountry.set('ALL');

    } catch (error) {
      console.error('AI Processing Error:', error);
      alert('خطا در پردازش هوشمند. لطفا مجدد تلاش کنید یا کلید API را بررسی نمایید.');
    } finally {
      this.isAiLoading.set(false);
    }
  }

  clearAll() {
    this.inputText.set('');
    this.processedContent.set('');
    this.fileName.set(null);
    this.selectedCountry.set('ALL');
    this.aiPrompt.set('');
  }

  // --- Helpers ---

  // Legacy helper, largely replaced by regex in parsedRows but kept for reference if needed
  parseIpPort(input: string): ParsedResult | null {
    const ipv6Regex = /^\[(.*)\]:(\d+)$/;
    const ipv6Match = input.match(ipv6Regex);
    if (ipv6Match) return { ip: ipv6Match[1], port: ipv6Match[2], type: 'IPv6' };

    const lastColonIndex = input.lastIndexOf(':');
    if (lastColonIndex !== -1) {
      const ipPart = input.substring(0, lastColonIndex);
      const portPart = input.substring(lastColonIndex + 1);
      if (!/^\d+$/.test(portPart)) return null; 
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(ipPart);
      return { ip: ipPart, port: portPart, type: isIp ? 'IPv4' : 'Domain' };
    }
    return null;
  }

  async copyToClipboard(text: string, fieldName: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedField.set(fieldName);
      setTimeout(() => this.copiedField.set(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.processFile(file);
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.processFile(file);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  processFile(file: File) {
    this.fileName.set(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      this.inputText.set(content); 
    };
    reader.readAsText(file);
  }

  downloadResult() {
    const text = this.finalOutput();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ip_list_${this.selectedCountry()}_${new Date().getTime()}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}