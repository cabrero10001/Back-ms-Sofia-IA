import { create } from 'zustand';
import type { AuthUser, ApiResponse, LoginPayload, LoginResponse } from '../types';
import { apiClient } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('sofia_token'),
  loading: false,
  error: null,

  login: async (payload: LoginPayload) => {
    set({ loading: true, error: null });
    try {
      const res = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', payload);
      const { accessToken, usuario } = res.data;
      localStorage.setItem('sofia_token', accessToken);
      apiClient.setToken(accessToken);
      set({ user: usuario, token: accessToken, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('sofia_token');
    apiClient.setToken(null);
    set({ user: null, token: null });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('sofia_token');
    if (!token) return;
    apiClient.setToken(token);
    try {
      const res = await apiClient.get<ApiResponse<AuthUser>>('/auth/me');
      set({ user: res.data, token });
    } catch {
      localStorage.removeItem('sofia_token');
      apiClient.setToken(null);
      set({ user: null, token: null });
    }
  },
}));
