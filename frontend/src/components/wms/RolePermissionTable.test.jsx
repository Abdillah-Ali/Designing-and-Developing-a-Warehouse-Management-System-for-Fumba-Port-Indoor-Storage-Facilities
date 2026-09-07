import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RolePermissionTable } from './RolePermissionTable';

const permissions = [
  { permission_key: 'cargo.register', module: 'cargo', description: 'Register cargo' },
  { permission_key: 'gate.gate_out.confirm', module: 'gate', description: 'Confirm gate-out' },
];

describe('role-specific permission choices', () => {
  it('hides unsupported permissions even when they were previously assigned', () => {
    const onToggle = vi.fn();
    render(<RolePermissionTable permissions={permissions} allowedKeys={['gate.gate_out.confirm']} assigned={['cargo.register']} onToggle={onToggle} />);
    expect(screen.queryByRole('checkbox', { name: 'Toggle cargo.register' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle gate.gate_out.confirm' }));
    expect(onToggle).toHaveBeenCalledWith('gate.gate_out.confirm');
  });

  it('prevents edits while saving and preserves protected assignments', () => {
    const { rerender } = render(<RolePermissionTable permissions={permissions} allowedKeys={['cargo.register']} assigned={[]} disabled onToggle={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    rerender(<RolePermissionTable permissions={[{ ...permissions[0], system_protected: true }]} allowedKeys={['cargo.register']} assigned={['cargo.register']} onToggle={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('shows an explicit empty state for roles without portal permissions', () => {
    render(<RolePermissionTable permissions={permissions} allowedKeys={[]} assigned={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('No configurable permissions for this role')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
