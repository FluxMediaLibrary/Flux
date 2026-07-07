'use client';

import { TimeSlider } from '@vidstack/react';

/**
 * Flux-branded timeline / seek bar.
 *
 * Uses Vidstack's headless TimeSlider components for accessibility, keyboard
 * support, and touch gestures. Flux provides only the visual styling.
 *
 * Composable structure:
 *   TimeSlider.Root (the slider)
 *   ├── TimeSlider.Track (the track background)
 *   │   ├── TimeSlider.TrackFill (played portion)
 *   │   └── TimeSlider.Progress (buffered portion)
 *   ├── TimeSlider.Thumb (draggable thumb)
 *   └── TimeSlider.Preview ( hover time tooltip)
 *       └── TimeSlider.Value (formatted time)
 */
export function Timeline() {
  return (
    <div className="fx-timeline">
      <TimeSlider.Root className="fx-seek" keyStep={5} shiftKeyMultiplier={2}>
        {/* Preview tooltip on hover */}
        <TimeSlider.Preview className="fx-seek-preview">
          <TimeSlider.Value className="fx-seek-preview-time" type="pointer" format="time" />
        </TimeSlider.Preview>

        {/* Track */}
        <TimeSlider.Track className="fx-seek-track">
          <TimeSlider.TrackFill className="fx-seek-played" />
          <TimeSlider.Progress className="fx-seek-buffered" />
        </TimeSlider.Track>

        {/* Draggable thumb */}
        <TimeSlider.Thumb className="fx-seek-thumb" />
      </TimeSlider.Root>
    </div>
  );
}
