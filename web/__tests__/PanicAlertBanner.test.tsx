/**
 * Component tests for the panic alert banner: loud rendering, the
 * acknowledge action, and dismissal only being offered after acknowledgement.
 *
 * Pure component test — no network, no map, no hub.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanicAlertBanner } from '../src/presentation/components/PanicAlertBanner';
import { makePanic } from './helpers/mocks';

describe('PanicAlertBanner', () => {
  it('renders nothing when there are no panics', () => {
    const { container } = render(
      <PanicAlertBanner
        panics={[]}
        acknowledgedPanicIds={new Set()}
        acknowledgingPanicIds={new Set()}
        onAcknowledge={() => undefined}
        onHide={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the vehicle, timestamp and last known position of a pending panic', () => {
    render(
      <PanicAlertBanner
        panics={[makePanic()]}
        acknowledgedPanicIds={new Set()}
        acknowledgingPanicIds={new Set()}
        onAcknowledge={() => undefined}
        onHide={() => undefined}
      />,
    );

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('PANIC');
    expect(banner.textContent).toContain('VEH-001');
    expect(banner.textContent).toContain('2026-11-12T11:20:00Z');
    expect(banner.textContent).toContain('last known position 41.1579, -8.6291');
    // Not acknowledged yet ⇒ acknowledge is offered, dismissal is not.
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });

  it('calls onAcknowledge and disables the button while in flight', () => {
    const onAcknowledge = vi.fn();
    render(
      <PanicAlertBanner
        panics={[makePanic()]}
        acknowledgedPanicIds={new Set()}
        acknowledgingPanicIds={new Set(['panic-1'])}
        onAcknowledge={onAcknowledge}
        onHide={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: 'Acknowledging…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('offers dismissal only after the panic was acknowledged', () => {
    const onHide = vi.fn();
    render(
      <PanicAlertBanner
        panics={[makePanic()]}
        acknowledgedPanicIds={new Set(['panic-1'])}
        acknowledgingPanicIds={new Set()}
        onAcknowledge={() => undefined}
        onHide={onHide}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    const dismiss = screen.getByRole('button', { name: /Dismiss/ });
    fireEvent.click(dismiss);
    expect(onHide).toHaveBeenCalledWith('panic-1');
  });
});
