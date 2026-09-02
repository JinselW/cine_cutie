const visualStyles = {
  scifi: {
    style: 'Neo-Noir Cyberpunk',
    description: 'Cold blues and neon accents against deep shadows. Clean geometric compositions with holographic UI elements. Sterile corporate environments contrasted with gritty underground spaces.',
    palette: [
      { name: 'Deep Space', hex: '#0a0e27', role: 'Primary background' },
      { name: 'Neon Cyan', hex: '#00f0ff', role: 'Accent / UI elements' },
      { name: 'Hologram Blue', hex: '#4a9eff', role: 'Technology highlights' },
      { name: 'Warning Amber', hex: '#ff8c00', role: 'Alerts / tension' },
      { name: 'Sterile White', hex: '#e0e8f0', role: 'Corporate environments' },
      { name: 'Void Black', hex: '#050510', role: 'Deep shadows' }
    ],
    lighting: 'High contrast with strong rim lighting. Neon sources cast colored shadows. Screen glow illuminates faces from below.',
    cameraStyle: 'Wide anamorphic lenses, slow deliberate movements. Symmetrical compositions for corporate spaces, handheld for underground scenes.'
  },
  romance: {
    style: 'Golden Hour Impressionism',
    description: 'Warm amber tones with soft pastel accents. Shallow depth of field creates dreamy bokeh. European architecture frames intimate moments.',
    palette: [
      { name: 'Golden Hour', hex: '#f0c040', role: 'Primary warmth' },
      { name: 'Rose Petal', hex: '#ff8fab', role: 'Romance accent' },
      { name: 'Cream', hex: '#f5f0e8', role: 'Soft backgrounds' },
      { name: 'Dusty Lavender', hex: '#b8a9c9', role: 'Nostalgia' },
      { name: 'Espresso', hex: '#3e2723', role: 'Bookshop warmth' },
      { name: 'Sky Blue', hex: '#87ceeb', role: 'Open skies' }
    ],
    lighting: 'Natural light preferred. Golden hour backlighting for romantic scenes. Soft window light for intimate conversations.',
    cameraStyle: 'Medium close-ups with shallow DOF. Slow dolly shots following characters through spaces. Handheld for spontaneous moments.'
  },
  mystery: {
    style: 'Chiaroscuro Noir',
    description: 'Deep blacks and muted tones with selective color accents. Heavy shadows create visual uncertainty. Architecture looms over characters.',
    palette: [
      { name: 'Midnight', hex: '#0a0a14', role: 'Dominant shadow' },
      { name: 'Slate Grey', hex: '#2d3436', role: 'Urban surfaces' },
      { name: 'Blood Crimson', hex: '#8b0000', role: 'Danger accent' },
      { name: 'Candlelight', hex: '#daa520', role: 'Revealing light' },
      { name: 'Fog Blue', hex: '#4a6274', role: 'Atmosphere' },
      { name: 'Bone White', hex: '#d4c5a9', role: 'Documents / evidence' }
    ],
    lighting: 'Low-key lighting with single practical sources. Venetian blind shadows. Faces half-lit to suggest duality.',
    cameraStyle: 'Dutch angles for unease. Slow push-ins during revelations. Reflections in windows and mirrors add visual layers.'
  },
  adventure: {
    style: 'Epic Naturalism',
    description: 'Rich earth tones with vivid sky contrasts. Vast landscapes dwarf human figures. Warm interiors contrast with wild exteriors.',
    palette: [
      { name: 'Forest Green', hex: '#1a5c3a', role: 'Nature primary' },
      { name: 'Earth Brown', hex: '#8b6914', role: 'Grounding tone' },
      { name: 'Glacier Blue', hex: '#7fdbda', role: 'Ice / water' },
      { name: 'Sunset Orange', hex: '#e67e22', role: 'Warmth / fire' },
      { name: 'Stone Grey', hex: '#636e72', role: 'Rock / ruins' },
      { name: 'Parchment', hex: '#f0e6d2', role: 'Maps / documents' }
    ],
    lighting: 'Natural daylight with dramatic cloud cover. Fire and torchlight for underground scenes. Lens flares for epic vistas.',
    cameraStyle: 'Sweeping aerials for landscapes. Eye-level tracking for journeys. Low angles for monumental discoveries.'
  },
  comedy: {
    style: 'Bright Pop Saturation',
    description: 'Vibrant, saturated colors with clean compositions. Bright domestic settings contrast with character chaos. Visual gags hidden in frame.',
    palette: [
      { name: 'Kitchen Yellow', hex: '#ffd93d', role: 'Warmth / humor' },
      { name: 'Candy Pink', hex: '#ff6b8a', role: 'Playful accent' },
      { name: 'Sky Blue', hex: '#74b9ff', role: 'Optimism' },
      { name: 'Granny Purple', hex: '#a29bfe', role: 'Character warmth' },
      { name: 'Mint Green', hex: '#55efc4', role: 'Fresh / clean' },
      { name: 'Coral', hex: '#fd79a8', role: 'Energy / chaos' }
    ],
    lighting: 'Bright, even lighting with minimal shadows. Practical household lights. Phone screen glow for social media moments.',
    cameraStyle: 'Static wide shots for physical comedy. Quick zooms for reactions. Phone-camera POV for social media segments.'
  },
  fantasy: {
    style: 'Painterly Mysticism',
    description: 'Rich jewel tones with ethereal light sources. Ancient textures contrast with magical luminescence. Every frame feels like a storybook illustration.',
    palette: [
      { name: 'Enchanted Purple', hex: '#6c3483', role: 'Magic primary' },
      { name: 'Ancient Gold', hex: '#d4a017', role: 'Wisdom / value' },
      { name: 'Storyfire Red', hex: '#e74c3c', role: 'Danger / transformation' },
      { name: 'Mystic Teal', hex: '#1abc9c', role: 'Healing / hope' },
      { name: 'Shadow Grey', hex: '#2c3e50', role: 'The Censors / void' },
      { name: 'Parchment Glow', hex: '#f5e6ca', role: 'Books / knowledge' }
    ],
    lighting: 'Sourceless magical glow for enchanted objects. Warm torchlight in ancient spaces. Ethereal backlighting for magical beings.',
    cameraStyle: 'Slow, reverent movements through spaces. Tilt up to reveal scale. Close-ups on hands touching magical objects.'
  }
};

export function generateVisualDesign(genre) {
  const v = visualStyles[genre] || visualStyles.fantasy;
  return { ...v, genre };
}
