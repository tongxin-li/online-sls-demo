/* Native SVG equipment for the power network.
 *
 * PowerEquipment.render(host, role)
 *   host is one D3 selection. It keeps its position, label and event handlers.
 *   role is Homes, Solar, Battery or Substation. Repeated calls are safe.
 *
 * PowerEquipment.update(host, {
 *   voltage: 1.0,       // Actual bus voltage in per unit, not voltage deviation.
 *   referenceVoltage: 1.0, // Nominal feeder voltage for this bus in per unit.
 *   input: 0,          // Actual inverter reactive output at this bus in kvar.
 *   inputScale: 100,   // Inverter reactive capability in kvar for the effort display.
 *   selected: false,
 *   activePulse: false,
 *   activePulses: 0,   // Optional number of overlapping applied pulses at this bus.
 *   queuedPulses: 0,   // Requests waiting for the next physical model sample.
 *   pulseId: null,     // Change for EVERY applied pulse, even in the same step.
 *   phase: 0           // Optional simulation step. Recorded, not invented motion.
 * })
 *
 * The battery bars display reactive inverter effort, never battery state of charge.
 * Voltage changes the surrounding ring and window light. No visual state feeds
 * back into the physical model. Hit area radius 21. Equipment radius 13.5.
 */
(function (root) {
  'use strict';

  const roles = new Set(['Homes', 'Solar', 'Battery', 'Substation']);
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = value => Math.max(0, Math.min(1, value));

  function path(g, className, d) {
    return g.append('path').attr('class', className).attr('d', d);
  }

  function render(host, requestedRole) {
    const role = roles.has(requestedRole) ? requestedRole : 'Homes';
    host.classed('pe-host', true);
    let equipment = host.select('.pe-root');
    if (!equipment.empty() && equipment.attr('data-equipment') === role) return equipment;
    equipment.remove();
    host.selectAll('.pe-hit').remove();
    host.insert('circle', ':first-child').attr('class', 'pe-hit').attr('r', 21);
    equipment = host.append('g').attr('class', 'pe-root').attr('data-equipment', role).attr('aria-hidden', 'true');
    equipment.append('circle').attr('class', 'pe-attack-halo').attr('r', 22);
    equipment.append('circle').attr('class', 'pe-voltage-wash').attr('r', 16);
    equipment.append('circle').attr('class', 'pe-disc').attr('r', 13.5);
    equipment.append('circle').attr('class', 'pe-voltage-ring').attr('r', 14.5);
    const glyph = equipment.append('g').attr('class', 'pe-glyph');

    if (role === 'Homes') {
      // A small pair of houses with separate roof and window shapes.
      path(glyph, 'pe-house-back', 'M2-2V7H10V-2L6-6Z');
      path(glyph, 'pe-roof-back', 'M0-2L6-7L12-2');
      path(glyph, 'pe-house', 'M-10-1V8H3V-1L-3.5-7Z');
      path(glyph, 'pe-roof', 'M-12 0L-3.5-8L5 0');
      glyph.append('rect').attr('class', 'pe-window').attr('x', -7.5).attr('y', 1).attr('width', 3.1).attr('height', 3.1).attr('rx', .45);
      glyph.append('rect').attr('class', 'pe-window pe-window-back').attr('x', 5.5).attr('y', -.1).attr('width', 2).attr('height', 2).attr('rx', .3);
      path(glyph, 'pe-door', 'M-1 8V3H1.2V8');
      path(glyph, 'pe-chimney', 'M-9-4V-8H-6.5V-6');
    } else if (role === 'Solar') {
      const sun = glyph.append('g').attr('class', 'pe-sun').attr('transform', 'translate(6 -7)');
      sun.append('circle').attr('class', 'pe-sun-disc').attr('r', 2.4);
      path(sun, 'pe-sun-rays', 'M0-4V-5M0 4V5M-4 0H-5M4 0H5M-2.9-2.9L-3.6-3.6M2.9-2.9L3.6-3.6M-2.9 2.9L-3.6 3.6M2.9 2.9L3.6 3.6');
      path(glyph, 'pe-cloud', 'M0-5.8C-2.9-5.8-3.5-9.5-.5-10.1C.2-13.3 5.1-13.6 6.5-10.2C10.2-11 11.9-5.8 8-5.8Z');
      path(glyph, 'pe-panel-frame', 'M-9-3H5L9 6H-12Z');
      path(glyph, 'pe-panel-grid', 'M-8 1.5H7M-4.5-3L-5.7 6M.2-3L2 6');
      path(glyph, 'pe-panel-stand', 'M-2 6V10M-7 10H3');
    } else if (role === 'Battery') {
      glyph.append('rect').attr('class', 'pe-battery-body').attr('x', -8).attr('y', -8).attr('width', 16).attr('height', 18).attr('rx', 2.3);
      glyph.append('rect').attr('class', 'pe-battery-terminal').attr('x', -3).attr('y', -10.2).attr('width', 6).attr('height', 2.2).attr('rx', .7);
      for (let i = 0; i < 3; i++) {
        glyph.append('rect').attr('class', 'pe-effort-segment').attr('data-segment', i).attr('x', -5.2).attr('y', 5.8 - i * 4.1).attr('width', 10.4).attr('height', 2.7).attr('rx', .7);
      }
      path(glyph, 'pe-control-arrow', 'M-2.3-4.4H2.3M.3-6.3L2.4-4.4L.3-2.5');
      path(glyph, 'pe-charging-surge', 'M-13-4V4M-16 1L-13 4L-10 1');
    } else {
      path(glyph, 'pe-station-base', 'M-11 10H11M-8 10V7H8V10');
      glyph.append('rect').attr('class', 'pe-transformer').attr('x', -9).attr('y', -3).attr('width', 18).attr('height', 10).attr('rx', 2);
      path(glyph, 'pe-coil', 'M-4-1V5M-1-1V5M2-1V5M5-1V5');
      path(glyph, 'pe-insulator', 'M-6-3V-9M5-3V-9M-8-7H-4M-8-5H-4M3-7H7M3-5H7');
      path(glyph, 'pe-station-wire', 'M-11-10H-6V-9M5-9V-10H11');
    }

    const target = equipment.append('g').attr('class', 'pe-target');
    path(target, 'pe-target-brackets', 'M-18-8V-13Q-18-18-13-18H-8M8-18H13Q18-18 18-13V-8M18 8V13Q18 18 13 18H8M-8 18H-13Q-18 18-18 13V8');
    path(target, 'pe-target-bolt', 'M12-22L7-14H12L9-7L19-17H14L17-22Z');
    equipment.append('g').attr('class', 'pe-event-layer');
    // This badge remains visible for the full physical disturbance. It is not
    // tied to an animation frame or hidden when a short impact burst ends.
    const attack = equipment.append('g').attr('class', 'pe-attack-badge').attr('transform', 'translate(13 -14)').attr('display', 'none');
    attack.append('rect').attr('x', -9).attr('y', -9).attr('width', 18).attr('height', 18).attr('rx', 9);
    path(attack, 'pe-attack-bolt', 'M1.4-6.3L-4.4 1H-.9L-2 6.1L4.8-1.8H1L3.1-6.3Z');
    attack.append('text').attr('x', 13).attr('y', .4).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle');
    return equipment;
  }

  function flash(equipment) {
    const layer = equipment.select('.pe-event-layer');
    layer.selectAll('*').remove();
    // New SVG nodes restart the burst even on repeated clicks in one step.
    const burst = layer.append('g').attr('class', 'pe-burst');
    burst.append('circle').attr('class', 'pe-burst-ring').attr('r', 16);
    path(burst, 'pe-burst-rays', 'M0-21V-28M14.8-14.8L19.8-19.8M21 0H28M14.8 14.8L19.8 19.8M0 21V28M-14.8 14.8L-19.8 19.8M-21 0H-28M-14.8-14.8L-19.8-19.8');
    path(burst, 'pe-burst-bolt', 'M3-15L-7-1H-.7L-3.2 11L10-6H3L7-15Z');
  }

  function update(host, data = {}) {
    let equipment = host.select('.pe-root');
    if (equipment.empty()) equipment = render(host, data.role || 'Homes');
    const voltage = finite(data.voltage, 1);
    const input = finite(data.input, 0);
    const inputScale = Math.max(Math.abs(finite(data.inputScale, 100)), 1e-9);
    const effort = clamp(Math.abs(input) / inputScale);
    const queuedPulses = Math.max(0, Math.floor(finite(data.queuedPulses, 0)));
    const activePulses = Math.max(0, Math.floor(finite(data.activePulses, data.activePulse ? 1 : 0)));
    const attacked = Boolean(data.activePulse) || queuedPulses > 0 || activePulses > 0;
    const pulseCount = queuedPulses + activePulses;
    const reference = finite(data.referenceVoltage, 1);
    const stress = clamp(Math.abs(voltage - reference) / .025);
    const voltageColor = voltage < .95 || voltage > 1.05 || stress > .6 ? '#be793e' : stress > .25 ? '#859454' : '#4c816b';
    equipment.attr('data-voltage', voltage).attr('data-control', input)
      .attr('data-phase', finite(data.phase, 0)).attr('data-pulse-active', String(Boolean(data.activePulse)))
      .classed('pe-selected', Boolean(data.selected)).classed('pe-pulse-active', Boolean(data.activePulse))
      .classed('pe-attacked', attacked).classed('pe-pulse-queued', queuedPulses > 0)
      .style('--pe-voltage-color', voltageColor).style('--pe-voltage-opacity', .04 + stress * .2)
      .style('--pe-window-opacity', .35 + .65 * clamp((voltage - .9) / .1));
    equipment.select('.pe-voltage-wash').attr('r', 15 + stress * 5);
    equipment.select('.pe-voltage-ring').attr('stroke-width', 1 + stress * 1.1);
    equipment.selectAll('.pe-effort-segment').each(function () {
      const index = Number(this.getAttribute('data-segment'));
      this.style.opacity = String(.15 + .85 * clamp(effort * 3 - index));
    });
    equipment.select('.pe-control-arrow').attr('transform', input < 0 ? 'rotate(180 0 -4.4)' : null).attr('opacity', effort > .01 ? .85 : .2);
    const badge = equipment.select('.pe-attack-badge').attr('display', attacked ? null : 'none')
      .attr('data-pulse-count', pulseCount).attr('data-queued-count', queuedPulses);
    const showCount = pulseCount > 1;
    badge.select('rect').attr('width', showCount ? 32 : 18);
    badge.select('text').attr('display', showCount ? null : 'none').text(pulseCount > 99 ? '99+' : String(pulseCount));
    // The one pulse token belongs to the host DOM node, not a mutable model object.
    const node = equipment.node();
    if (data.pulseId !== undefined && data.pulseId !== null && node.__pePulseId !== data.pulseId) {
      node.__pePulseId = data.pulseId;
      flash(equipment);
    }
    if (data.pulseId === null) {
      node.__pePulseId = null;
      equipment.select('.pe-event-layer').selectAll('*').remove();
    }
    return equipment;
  }

  root.PowerEquipment = { render, update, flash };
})(typeof window !== 'undefined' ? window : globalThis);
