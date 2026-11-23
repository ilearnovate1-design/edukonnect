import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { AnnouncementAudience } from '../types';

export const sendNotification = async (
  userIds: string[],
  title: string,
  message: string,
  type: string,
  schoolId: string
) => {
  const cleanSchool = (schoolId || '').trim().toLowerCase();
  if (userIds.length === 0 || !cleanSchool) return;

  const batch = writeBatch(db);
  userIds.forEach(uid => {
    const notifId = `notif_${uid}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const ref = doc(db, 'notifications', notifId);
    batch.set(ref, {
      notificationId: notifId,
      schoolId: cleanSchool,
      userId: uid,
      title,
      message,
      type,
      read: false,
      createdAt: serverTimestamp()
    });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('Error sending notifications:', err);
  }
};

export const broadcastAnnouncementNotifications = async (
  audience: AnnouncementAudience,
  title: string,
  message: string,
  classId?: string,
  schoolId?: string
) => {
  const cleanSchool = (schoolId || '').trim().toLowerCase();
  if (!cleanSchool) return;

  try {
    const targetUserIds = new Set<string>();

    if (audience === 'ALL' || audience === 'TEACHERS') {
      const teachersSnap = await getDocs(query(
        collection(db, 'teachers'),
        where('schoolId', '==', cleanSchool),
        where('status', '==', 'ACTIVE')
      ));
      teachersSnap.forEach(d => {
        const uid = d.data().userId;
        if (uid) targetUserIds.add(uid);
      });
    }

    if (audience === 'ALL' || audience === 'PARENTS') {
      const parentsSnap = await getDocs(query(
        collection(db, 'parents'),
        where('schoolId', '==', cleanSchool),
        where('status', '==', 'ACTIVE')
      ));
      parentsSnap.forEach(d => {
        const uid = d.data().userId;
        if (uid) targetUserIds.add(uid);
      });
    }

    if (audience === 'CLASS_SPECIFIC' && classId) {
      const studentsSnap = await getDocs(query(
        collection(db, 'students'),
        where('schoolId', '==', cleanSchool),
        where('classId', '==', classId)
      ));
      const parentIdsToNotify = new Set<string>();
      studentsSnap.forEach(d => {
        const pIds = d.data().parentIds || [];
        pIds.forEach((pid: string) => parentIdsToNotify.add(pid));
      });

      if (parentIdsToNotify.size > 0) {
        const parentsSnap = await getDocs(query(
          collection(db, 'parents'),
          where('schoolId', '==', cleanSchool)
        ));
        parentsSnap.forEach(d => {
          const parentData = d.data();
          if (parentIdsToNotify.has(parentData.parentId) && parentData.userId) {
            targetUserIds.add(parentData.userId);
          }
        });
      }
    }

    if (targetUserIds.size > 0) {
      const usersArray = Array.from(targetUserIds);
      const chunkSize = 400;
      for (let i = 0; i < usersArray.length; i += chunkSize) {
        const chunk = usersArray.slice(i, i + chunkSize);
        await sendNotification(chunk, title || 'New Notification', message, 'ANNOUNCEMENT', cleanSchool);
      }
    }
  } catch (err) {
    console.error('Error broadcasting notifications:', err);
  }
};
