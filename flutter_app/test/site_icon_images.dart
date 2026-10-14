// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'dart:convert';
import 'dart:typed_data';

// Small real images, 16 by 16 pixels each.
const _images = <String, String>{
  'png': 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR4nGO8o6Hxn4ECwESJ5sFhAAu6gPL163g13NXUpK4LmEYNYBh4AxhH8wIDAAqMB3fvNuOMAAAAAElFTkSuQmCC',
  'icoPng': 'AAABAAEAEBAAAAAAIABpAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAADBJREFUeJxjvKOh8Z+BAsBEiebBYQALuoDy9et4NdzV1KSuC5hGDWAYeAMYR/MCAwAKjAd37zbjjAAAAABJRU5ErkJggg==',
  'icoBmp': 'AAABAAEAEBAAAAAAIAAoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAMQOAADEDgAAAAAAAAAAAAAoKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc////////////////////////////////////////////KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P///////////////////////////////////////////ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz///////////////////////////////////////////8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc////////////////////////////////////////////KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P///////////////////////////////////////////ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz///////////////////////////////////////////8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc////////////////////////////////////////////KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P///////////////////////////////////////////ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/KCjc/ygo3P8oKNz/',
  'gif': 'R0lGODdhEAAQAIEAAP///9woKAAAAAAAACwAAAAAEAAQAEAIMAADCBxIsGBBAAgTIjQoUKFChhAjSjToMCHEigsnatzI8SDGix8ZYgQAsmLHkwUDAgA7',
  'jpg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCbwd4O/wCEs+2/6f8AZfs2z/ljv3bt3+0Mfd/Wjxj4O/4RP7F/p/2r7Tv/AOWOzbt2/wC0c/e/Sjwd4x/4RP7b/oH2r7Ts/wCW2zbt3f7Jz979KPGPjH/hLPsX+gfZfs2//ltv3btv+yMfd/WvL/dey/vH3n+3fXv+nXy7ffv/AFY//9k=',
  'webp': 'UklGRjAAAABXRUJQVlA4TCQAAAAvD8ADAA/wlP93/z/lf/7jAWTSNhLq3+Uc9CqzENH/CTDZYwI=',
};

Uint8List iconImage(String name) => base64.decode(_images[name]!);
