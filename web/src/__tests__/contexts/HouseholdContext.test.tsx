/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { HouseholdProvider, useHousehold } from '@/contexts/HouseholdContext';
import * as householdService from '@/lib/householdService';

jest.mock('@/lib/householdService', () => ({
  getHousehold: jest.fn(),
  validateHouseholdKey: jest.fn(),
  getStoredHouseholdKey: jest.fn(),
  setStoredHouseholdKey: jest.fn(),
  clearStoredHouseholdKey: jest.fn(),
}));

// 테스트용 컴포넌트
function TestComponent() {
  const { household, householdKey, isLoading, isAuthenticated, login, logout } = useHousehold();

  if (isLoading) return <div data-testid="loading">Loading...</div>;

  return (
    <div>
      <span data-testid="authenticated">{isAuthenticated.toString()}</span>
      <span data-testid="household-key">{householdKey || 'null'}</span>
      <span data-testid="household-name">{household?.name || 'null'}</span>
      <button onClick={() => login('test-key')}>Login</button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

describe('HouseholdContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue(null);
  });

  describe('HouseholdProvider', () => {
    it('should complete loading when no stored key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue(null);

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      // 로딩 완료 후 인증되지 않은 상태
      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });

    it('should not be authenticated when no stored key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue(null);

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });

    it('should load household from stored key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue('stored-key');
      (householdService.validateHouseholdKey as jest.Mock).mockResolvedValue(true);
      (householdService.getHousehold as jest.Mock).mockResolvedValue({
        id: 'stored-key',
        name: 'Test Family',
        createdAt: new Date(),
      });

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('household-key')).toHaveTextContent('stored-key');
        expect(screen.getByTestId('household-name')).toHaveTextContent('Test Family');
      });
    });

    it('should clear invalid stored key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue('invalid-key');
      (householdService.validateHouseholdKey as jest.Mock).mockResolvedValue(false);

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(householdService.clearStoredHouseholdKey).toHaveBeenCalled();
      });
    });

    it('should login with valid key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue(null);
      (householdService.validateHouseholdKey as jest.Mock).mockResolvedValue(true);
      (householdService.getHousehold as jest.Mock).mockResolvedValue({
        id: 'test-key',
        name: 'New Family',
        createdAt: new Date(),
      });

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const loginButton = screen.getByText('Login');

      await act(async () => {
        loginButton.click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('household-key')).toHaveTextContent('test-key');
      });

      expect(householdService.setStoredHouseholdKey).toHaveBeenCalledWith('test-key');
    });

    it('should not login with invalid key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue(null);
      (householdService.validateHouseholdKey as jest.Mock).mockResolvedValue(false);

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      });

      const loginButton = screen.getByText('Login');

      await act(async () => {
        loginButton.click();
      });

      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(householdService.setStoredHouseholdKey).not.toHaveBeenCalled();
    });

    it('should logout and clear stored key', async () => {
      (householdService.getStoredHouseholdKey as jest.Mock).mockReturnValue('existing-key');
      (householdService.validateHouseholdKey as jest.Mock).mockResolvedValue(true);
      (householdService.getHousehold as jest.Mock).mockResolvedValue({
        id: 'existing-key',
        name: 'Existing Family',
        createdAt: new Date(),
      });

      render(
        <HouseholdProvider>
          <TestComponent />
        </HouseholdProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      const logoutButton = screen.getByText('Logout');

      act(() => {
        logoutButton.click();
      });

      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('household-key')).toHaveTextContent('null');
      expect(householdService.clearStoredHouseholdKey).toHaveBeenCalled();
    });
  });

  describe('useHousehold', () => {
    it('should throw error when used outside provider', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useHousehold must be used within a HouseholdProvider');

      consoleErrorSpy.mockRestore();
    });
  });
});
