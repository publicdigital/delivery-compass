# Demo video: the same question, with and without the library

About 40 seconds, no sound, captions on screen. It shows a real Claude.ai answer, not a
mock-up. The point it makes: asked plainly, Claude guesses; asked to use the library,
it quotes the rules and says what has changed.

## The question

**Do I need a business case for a £3m digital project?**

Chosen because the plain answer, in our own test on 31 October, said it "could not find
the new thresholds and process" after the 1 April 2026 spend control change, and cited
a housing magazine. The library answer found the current route (assurance team,
delegated limit, the novel/contentious/repercussive test) and the smaller Business
Justification Case option.

Backup if that contrast does not show up on the day: **Do I still need GDS approval for
digital spend?** (the library adds three "overtaken" warnings).

## Before you record

1. Use an **incognito chat** in Claude.ai (the ghost icon at the top of a new chat). It
   ignores your memory and history, so the answer cannot mention your own work. In an
   earlier test a follow-up answer referred to "your NHS work". If the connector is not
   available in an incognito chat, use a normal one and read the answer for anything
   personal before you record.
2. Collapse the sidebar so no chat titles show. Check your name and avatar are not in
   the frame, and close other tabs and notifications.
3. Make the browser window about 1280 pixels wide. Zoom to 110% if the text looks small.
4. Make sure the Gov Delivery Library connector is switched on for the chat.
5. Do a dry run of both questions first, and read the answers. If the plain answer
   happens to use the library, or the contrast is weak, use the backup question.

## Shots

Record each clip separately with the screen recorder (Mac: Cmd+Shift+5, choose
"Record selected portion" and draw it round the chat area). Do not edit anything; I
will trim, speed up the waiting and add captions.

| # | What to do on screen | Caption I will add | About |
|---|---|---|---|
| 1 | New incognito chat. Paste the plain question. Send. Let it answer. Scroll slowly to the part about spend controls or thresholds. Pause 2 seconds there. | "Asked plainly, Claude searches the web or answers from memory." | 15 s |
| 2 | New incognito chat. Paste the same question starting "Using the Gov Delivery Library,". Send. Wait until "Used Gov Delivery Library" shows. | "Start with 'Using the Gov Delivery Library'." | 8 s |
| 3 | Scroll slowly through the answer. Pause on a quoted "must" line, then on a linked heading. Hover over one link so the gov.uk address shows. | "It quotes the guidance, links the exact heading, and says what has changed." | 15 s |

Send me the clips (drag the files into this folder, `media/`). I will:

- trim and speed up the waiting parts, and crop to the chat
- export `trial/media/demo.mp4` (H.264, no sound, at most 1280 pixels wide, under 4 MB) and `demo.webm`
- make `demo-poster.jpg` from a frame of the library answer
- write the captions as `demo.vtt`, plus a short text description under the video for anyone who cannot play it

I need `ffmpeg` on this Mac for that. It is not installed yet; I will ask before
installing it.
