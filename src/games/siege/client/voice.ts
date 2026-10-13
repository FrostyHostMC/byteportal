import type { Client } from '@platform/client';

/**
 * The hostiles' radio. A callout ("C4 set.", "Fire in the hole!") arrives from the server as a
 * message and is said out loud on this screen, in a low, clipped war voice (the browser's own
 * speech), behind a click of the radio, and quieter the farther off whoever said it is. (The same
 * line is on screen as a feed line, for anyone with the sound off.)
 */
export function radioVoice(client: Client) {
  client.on('radio', (data) => {
    const m = data as { line?: unknown; x?: number; z?: number };
    if (typeof m.line !== 'string') return;
    const cam = client.camera.position;
    const dist = Math.hypot((m.x ?? cam.x) - cam.x, (m.z ?? cam.z) - cam.z);
    const volume = Math.max(0.2, Math.min(1, 1.2 - dist / 70));
    client.audio.play('squelch', { volume: volume * 0.8 });
    if (typeof speechSynthesis === 'undefined') return;
    const say = new SpeechSynthesisUtterance(m.line);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    say.voice = voices.find((v) => /male|david|mark|daniel|guy|george|james|fred|alex/i.test(v.name)) ?? voices[0] ?? null;
    say.pitch = 0.2; // low
    say.rate = 1.12; // clipped
    say.volume = volume;
    say.onend = () => client.audio.play('squelch', { volume: volume * 0.5 });
    speechSynthesis.speak(say);
  });
}
