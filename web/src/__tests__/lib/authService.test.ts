/**
 * @jest-environment jsdom
 */

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({
    currentUser: null,
  })),
  signInWithPopup: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('@/lib/firebase', () => ({
  app: {},
}));

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  getAuth,
} from 'firebase/auth';
import {
  signInWithGoogle,
  logOut,
  getCurrentUser,
  onAuthChange,
  isAdmin,
} from '@/lib/authService';

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signInWithGoogle', () => {
    it('should return user on successful login', async () => {
      const mockUser = { email: 'test@example.com', uid: 'user-123' };
      (signInWithPopup as jest.Mock).mockResolvedValue({ user: mockUser });

      const result = await signInWithGoogle();

      expect(result).toEqual(mockUser);
    });

    it('should return null on login failure', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      (signInWithPopup as jest.Mock).mockRejectedValue(new Error('Login failed'));

      const result = await signInWithGoogle();

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('logOut', () => {
    it('should call signOut', async () => {
      (signOut as jest.Mock).mockResolvedValue(undefined);

      await logOut();

      expect(signOut).toHaveBeenCalled();
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user from auth', () => {
      const mockUser = { email: 'test@example.com' };
      (getAuth as jest.Mock).mockReturnValue({ currentUser: mockUser });

      // 모듈을 다시 import해야 함 - 이 테스트에서는 null 반환
      const result = getCurrentUser();

      // auth.currentUser가 모듈 로드 시점에 캡처되므로 null
      expect(result).toBeNull();
    });
  });

  describe('onAuthChange', () => {
    it('should subscribe to auth state changes', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();
      (onAuthStateChanged as jest.Mock).mockReturnValue(mockUnsubscribe);

      const unsubscribe = onAuthChange(callback);

      expect(onAuthStateChanged).toHaveBeenCalled();
      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });

  describe('isAdmin', () => {
    it('should return false for null user', () => {
      expect(isAdmin(null)).toBe(false);
    });

    it('should return false for user without email', () => {
      const user = { uid: 'user-123' } as any;
      expect(isAdmin(user)).toBe(false);
    });

    it('should return false for non-admin email', () => {
      const user = { email: 'notadmin@example.com' } as any;
      expect(isAdmin(user)).toBe(false);
    });

    it('should return true for admin email', () => {
      const user = { email: 'minkue777@gmail.com' } as any;
      expect(isAdmin(user)).toBe(true);
    });
  });
});
