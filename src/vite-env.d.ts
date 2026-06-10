/// <reference types="vite/client" />

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

interface Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: unknown): Promise<unknown>;
    nip04?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
    nip44?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
  };
}
