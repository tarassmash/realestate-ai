// Инструкции для ИИ по каждому инструменту — общие для приложения и админки
const PRESET_BASE = "This is a real estate listing photo. Keep the exact same room layout, architecture, walls, ceiling, floor, windows, doors, camera angle and perspective. Do not add or remove structural elements and do not change the view through the windows unless asked. Output a photorealistic, professional real estate photograph.";

// o = { room, style, custom }
const PRESET_DEFS = [
  { id: "enhance", p: () => `${PRESET_BASE} Professionally retouch it: bright, natural, even lighting; balanced HDR exposure so window views are visible and not blown out; accurate neutral white balance (remove yellow or blue color casts); straighten converging vertical lines; crisp detail; remove noise. Do not move, add or remove any furniture or objects.` },
  { id: "staging", staging: true, p: (o) => `${PRESET_BASE} Virtually stage this space as ${o.room || "the appropriate room type"} with tasteful furniture and decor in ${o.style || "modern contemporary"} style. Realistic scale, contact shadows and reflections matching the existing light direction. Keep floors, walls, windows and built-in fixtures exactly unchanged. Bright, inviting, magazine-quality listing photo.` },
  { id: "declutter", staging: true, p: () => `${PRESET_BASE} Declutter the space: remove personal items, cables, toiletries, papers, fridge magnets, clothes, bags, shoes, toys, dishes, trash, family photos and small loose objects. Keep the main furniture in place. Leave clean, tidy surfaces.` },
  { id: "empty", staging: true, p: () => `${PRESET_BASE} Remove all movable furniture, rugs, decor and objects, leaving a clean, empty room with the bare floor, walls, windows, radiators, sockets and built-in fixtures intact. Fill removed areas with matching floor and wall texture.` },
  { id: "sky", staging: true, p: () => `${PRESET_BASE} Replace the sky with a clear, bright blue sky with a few soft white clouds, and adjust the exterior lighting to sunny daylight consistent with the new sky. Keep the building and surroundings unchanged.` },
  { id: "twilight", staging: true, p: () => `${PRESET_BASE} Convert this exterior photo into a professional dusk twilight shot: deep blue to warm orange sunset sky, warm glowing interior lights in every window, soft exterior and landscape lighting, gentle reflections. Keep the building unchanged.` },
  { id: "lawn", staging: true, p: () => `${PRESET_BASE} Make the lawn and landscaping lush, green and well maintained; tidy the yard and walkways; remove fallen leaves, debris, hoses, trash bins and parked construction items. Keep the building unchanged.` },
  { id: "refresh", staging: true, p: () => `${PRESET_BASE} Make the interior look freshly renovated: walls repainted in a clean warm white, remove stains, scuffs and cracks, clean and polish floors, tiles and surfaces. Keep the same materials, layout and furniture.` },
  { id: "upscale", upscaleOnly: true, p: () => "" },
  { id: "custom", staging: true, p: (o) => `${PRESET_BASE} Follow this instruction (it may be in any language): ${(o.custom || "").trim() || "Improve the photo."}` },
];
