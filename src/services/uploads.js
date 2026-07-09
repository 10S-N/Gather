import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

// Uploads a single image file to Firebase Storage under the given path
// (e.g. `avatars/<uid>` or `covers/<uid>`) and returns the public download URL.
//
// Throws on invalid type/size so callers can catch and surface to the UI.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function uploadImage(file, path) {
  if (!file) throw new Error('No file selected');
  if (!file.type?.startsWith('image/')) {
    throw new Error('Please choose an image file (PNG, JPG, GIF, WEBP).');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image is larger than 5 MB. Please choose a smaller file.');
  }
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return await getDownloadURL(fileRef);
}
