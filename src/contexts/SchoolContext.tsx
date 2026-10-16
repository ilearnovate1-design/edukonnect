import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, writeBatch, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { SchoolSettings, AppNotification } from '../types';
import { 
  getSchoolSettings, 
  DEFAULT_SCHOOL_SETTINGS, 
  saveSchoolSettings, 
  DEFAULT_TENANT_ID,
  resolveSchoolByDomain
} from '../services/schoolService';
import { useAuth } from './AuthContext';

interface SchoolContextType {
  schoolId: string;
  currentSchoolId: string;
  settings: SchoolSettings;
  loading: boolean;
  loadingSettings: boolean;
  isConfigured: boolean;
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  reloadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<SchoolSettings>) => Promise<void>;
  markNotificationsAsRead: () => Promise<void>;
  setSchoolId: (id: string) => void;
}

const SchoolContext = createContext<SchoolContextType | undefined>(undefined);

export const SchoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, appUser } = useAuth();
  const [activeSchoolId, setActiveSchoolId] = useState<string>(
    appUser?.schoolId || (appUser?.isSuperAdmin ? DEFAULT_TENANT_ID : '')
  );
  const [settings, setSettings] = useState<SchoolSettings>(DEFAULT_SCHOOL_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Resolve schoolId: First priority is user's authoritative schoolId.
  // Teachers and parents without a verified school membership MUST NOT silently fall back to default school.
  useEffect(() => {
    let isMounted = true;
    const determineSchoolId = async () => {
      if (appUser?.schoolId) {
        if (isMounted) setActiveSchoolId(appUser.schoolId);
        return;
      }

      if (appUser && (appUser.role === 'TEACHER' || appUser.role === 'PARENT')) {
        // Missing membership: do NOT silently fallback to default school
        if (isMounted) setActiveSchoolId('');
        return;
      }

      try {
        const domainSchoolId = await resolveSchoolByDomain(window.location.hostname);
        if (isMounted) {
          setActiveSchoolId(domainSchoolId || (appUser?.isSuperAdmin ? DEFAULT_TENANT_ID : ''));
        }
      } catch {
        if (isMounted) {
          setActiveSchoolId(appUser?.isSuperAdmin ? DEFAULT_TENANT_ID : '');
        }
      }
    };

    determineSchoolId();
    return () => { isMounted = false; };
  }, [appUser?.schoolId, appUser?.role, appUser?.isSuperAdmin]);

  const fetchSettings = useCallback(async () => {
    if (!activeSchoolId) {
      setSettings({ ...DEFAULT_SCHOOL_SETTINGS, schoolId: '' });
      setLoadingSettings(false);
      return;
    }
    try {
      const data = await getSchoolSettings(activeSchoolId);
      if (data) {
        setSettings(data);
      } else {
        setSettings({ ...DEFAULT_SCHOOL_SETTINGS, schoolId: activeSchoolId });
      }
    } catch (e: any) {
      console.warn('Notice in fetchSettings, using default settings:', e?.message || e);
      setSettings((prev) => prev || { ...DEFAULT_SCHOOL_SETTINGS, schoolId: activeSchoolId });
    } finally {
      setLoadingSettings(false);
    }
  }, [activeSchoolId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Listen for in-app notifications
  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: AppNotification[] = [];
      snapshot.forEach((doc) => {
        list.push({ notificationId: doc.id, ...(doc.data() as any) });
      });
      setNotifications(list);
    }, (error) => {
      console.warn('Notifications listener:', error.message);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const updateSettings = async (newSettings: Partial<SchoolSettings>) => {
    if (!activeSchoolId) {
      throw new Error('Cannot update settings: No active school context available.');
    }
    await saveSchoolSettings(newSettings, activeSchoolId);
    await fetchSettings();
  };

  const markNotificationsAsRead = async () => {
    if (!currentUser) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;

    try {
      const batch = writeBatch(db);
      unread.forEach(n => {
        batch.update(doc(db, 'notifications', n.notificationId), { read: true });
      });
      await batch.commit();
    } catch (err) {
      console.error('Failed to mark notifications as read', err);
    }
  };

  const unreadNotificationsCount = notifications.filter(n => !n.read).length;

  const setSchoolId = (id: string) => {
    // Only SUPER_ADMIN is permitted to switch active school view
    if (!appUser?.isSuperAdmin && appUser?.role !== 'SUPER_ADMIN') {
      console.warn('Unauthorized school switch attempt blocked: Only platform SUPER_ADMIN can switch schools.');
      return;
    }
    setActiveSchoolId(id);
    setLoadingSettings(true);
  };

  return (
    <SchoolContext.Provider
      value={{
        schoolId: activeSchoolId,
        currentSchoolId: activeSchoolId,
        settings,
        loading: loadingSettings,
        loadingSettings,
        isConfigured: !!settings?.schoolName,
        notifications,
        unreadNotificationsCount,
        reloadSettings: fetchSettings,
        updateSettings,
        markNotificationsAsRead,
        setSchoolId,
      }}
    >
      {children}
    </SchoolContext.Provider>
  );
};

export const useSchool = (): SchoolContextType => {
  const ctx = useContext(SchoolContext);
  if (!ctx) {
    throw new Error('useSchool must be used within a SchoolProvider');
  }
  return ctx;
};
