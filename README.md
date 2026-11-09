# Music Score

A WebWriter widget for creating, importing, and playing scores with alphaTab.

1. Run `npm ci` and `npm run build` in this directory. In WebWriter, choose **Develop → Local packages → Load**, select this directory, and insert **Music Score**.
2. Click a beat or note to open its choices and focus the search field. Type a pitch such as `g` or `g#4`, `r` for a rest, or `+g` to add a chord tone to an existing note. Click a choice or use the arrow keys in the search field and press Enter. Use Tab and Shift+Tab to move between beats in the current voice. Press Escape to close the menu. You can also double-click the staff to place a note, or drag a notehead vertically to preview and change its pitch.
3. Type `/8` to choose an eighth-note duration, or enter pitch and duration together as `g#4/8`. Values range from `/1` (whole) through `/64`. Add a dot or two for dotted values. Enter a dotted eighth rest as `r/8.` or a quarter-note chord as `<c4 e4 g4>/4`. A bare pitch uses the current duration, which carries forward as you enter notes. The autocomplete lists the values that fit.
4. Click a clef, key signature, or time signature to choose an option directly. Select a beat and type `key Bb major` or `key F# minor` to change the key even when there are no printed accidentals. A key change keeps existing pitches and applies from the selected measure until the next key change on staves that share its signature. Click the BPM digits to edit tempo in place. Press Enter or click away to save, or press Escape to cancel. While the score is focused, click **+** to add one measure. Drag the final barline forward to add measures or backward to remove them, including across staff lines. Each new measure appears once you drag to its far edge, and the current line can reflow. Measures marked for removal fade to red. Release to apply the change, or press Escape to cancel. The first measure stays available for editing.
5. Use **Play/Pause** and **Stop** beside the title or first staff. They stay visible while you scroll and turn blue during playback. Playback closes the autocomplete and keeps the current bar visible with smooth scrolling between systems. The score grows with each system. Save as usual in WebWriter.

New widgets start with one editable measure in 4/4. Choose **Practice phrase** from the **Music Score** package menu to insert a two-measure piano example. To bring in another score, use **Import MusicXML** in the Widget drawer. The importer accepts `.musicxml`, `.xml`, and `.mxl` files up to 8 MiB. See the [example's MusicXML source](test/phrase.musicxml).

Choose **Bach · Prelude in C major** to insert the complete BWV 846 piano prelude from Book I of *The Well-Tempered Clavier*. The [MusicXML source](test/bach-prelude.musicxml) follows Tobias Erbsland’s public-domain [Mutopia edition](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5).

Click a note or beat to select it. Drag along the staff to select a passage across measures and systems, or Shift-click to extend it. Select adjacent eighth notes or shorter and use `beam` to join them, `unbeam` to split their joins, or `beam auto` to restore automatic grouping. Drag a selected passage to move it. Use the standard copy, cut, and paste shortcuts or press Delete to clear the selection. Select a rest as the paste destination. Pasting and moving require enough rests in a compatible staff, and leave the timing of surrounding notes in place. To remove or move linked notes such as ties, select the whole link.

Select a passage and use `tie` to join matching pitches on adjacent notes, or `slur` to mark the phrase from its first note to its last. Use `untie` or `unslur` on a single endpoint, or select the whole phrase to remove links within it.

Select three equal-value beats in one measure and choose `triplet`. For other group sizes, choose a compatible ratio such as `tuplet 5:4` for five selected beats. Select a note and type `grace g4` or `grace g4 a4` to insert a grace note or group before it.

Choose **Articulations & ornaments** on a note or passage to apply staccato, tenuto, accents, fermatas, trills, or turns. Type a marking such as `staccato` to apply it or `remove staccato` to clear it. Fermatas apply to the whole beat.

Click above a beat or on existing score text to edit it in place. Press Enter or click away to save, press Escape to cancel, or clear the field and save to remove the text. Click below a beat to choose or remove a dynamic from `ppp` to `fff`. Select a passage and enter `<` for crescendo or `>` for diminuendo. Use `remove hairpin` on a beat in the passage to clear it. Dynamic markings affect playback in the edited voice. Hairpins are visual markings.

Click below a note in the lyric area, or click a printed syllable, to edit the first verse inline. Tab and Shift+Tab save the current syllable and move between notes in the same voice, skipping rests and grace notes. Click the printed title or subtitle to edit it. When the score has focus, **Add title** and **Add subtitle** appear for missing headings.

Select the score and open its **Edit** tools to find the **Type** setting. Choose **Standard staff** (the default), **Guitar tab**, **Drum tab**, or **Jianpu**. The document saves this display setting alongside the score. Parts that cannot be shown in the selected notation stay on standard staves. The **Music Score** package menu includes a ready-to-play snippet for each alternate notation.

Use **Size** in the same tools to choose **Compact**, **Normal** (the default), or **Spacious**. The setting controls the scale of the notation and is saved with the widget.

Click the instrument label beside the staff to search for a playback sound. Pitched parts offer the General MIDI programs, and percussion parts offer drum kits. The selected sound is saved for the whole part, including all of its staves. The label shows the current sound, and its tooltip identifies the part.

If you used the earlier local package, load the renamed `music-score` folder in WebWriter. Update any older score element tags to `webwriter-music-score` and keep their score data blocks.

Visual note entry targets the first voice on standard pitched staves. Duration editing preserves the timing of subsequent notes. Ties, tuplets, and grace notes remain playable. The authored score is stored in an inert JSON block inside the document. The bundled Bravura font and Sonivox SoundFont load locally.

Run `npm test` for score tests. `npm pack` builds the distributable package.

Music Score bundles alphaTab 1.9.0 under the Mozilla Public License 2.0. The bundled JavaScript includes the upstream copyright and license notices. The build script reproduces the changes applied to the pinned release. [alphaTab 1.9.0 source and release](https://github.com/CoderLine/alphaTab/releases/tag/v1.9.0), [MPL-2.0](https://www.mozilla.org/MPL/2.0/), [build script](build.mjs).
