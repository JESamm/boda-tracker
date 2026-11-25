import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text as NativeText,
  TextInput,
  type NativeSyntheticEvent,
  type TextProps,
  View,
} from 'react-native';
import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef, type PressEvent, type StyleSpecification } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, LineString, Point } from 'geojson';

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1')
  .replace(/\/+$/, '');
const osmMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: [`${apiBaseUrl}/maps/tiles/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-raster-layer', type: 'raster', source: 'osm-raster' }],
};
const sessionStorageKey = 'boda-rider-session';
const androidTopInset = Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0;
const colors = {
  primary: '#0f6cbd',
  primaryDark: '#004578',
  primarySoft: '#eff6fc',
  ink: '#242424',
  muted: '#616161',
  line: '#d1d1d1',
  canvas: '#f5f5f5',
  white: '#ffffff',
  accent: '#0f6cbd',
  accentSoft: '#eff6fc',
  red: '#c42b1c',
  dangerSoft: '#fdf3f4',
};

type RiderUser = {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  emailVerified: boolean;
  role: 'PLATFORM_ADMIN' | 'SACCO_ADMIN' | 'RIDER';
  saccoId: string | null;
  saccoName: string | null;
};

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: RiderUser;
};

type LoginStep = 'credentials' | 'login-code' | 'activation-email' | 'activation-code';
type LoginMethod = 'email' | 'phone';

type Tab = 'Today' | 'Trips' | 'Maps' | 'Account';

type WorkdayAssignment = {
  id: string;
  status: 'ACTIVE' | 'ENDED';
  assignedAt: string;
  unassignedAt: string | null;
  rider: { id: string; fullName: string; phoneNumber: string };
  vehicle: { id: string; registrationNumber: string; type: 'MOTORCYCLE' | 'MATATU' };
};

type WorkSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED';
  vehicle: WorkdayAssignment['vehicle'];
};

type RiderWorkspace = {
  assignment: WorkdayAssignment | null;
  workSession: WorkSession | null;
};

type RiderTrip = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  fareAmount: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  vehicle: WorkdayAssignment['vehicle'];
};

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

type PlaceSuggestion = {
  placeId: string;
  description: string;
} & MapCoordinate;

type PlaceDestination = MapCoordinate & {
  name: string;
};

type RouteOption = {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
};

const nairobiCoordinate: MapCoordinate = {
  latitude: -1.2864,
  longitude: 36.8172,
};

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('email');
  const [loginStep, setLoginStep] = useState<LoginStep>('credentials');
  const [verificationCode, setVerificationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [isPasswordChangeRequested, setIsPasswordChangeRequested] = useState(false);
  const [passwordChangeCode, setPasswordChangeCode] = useState('');
  const [passwordChangePassword, setPasswordChangePassword] = useState('');
  const [passwordChangeNotice, setPasswordChangeNotice] = useState('');
  const [emailUpdate, setEmailUpdate] = useState('');
  const [emailUpdateCode, setEmailUpdateCode] = useState('');
  const [isEmailUpdateCodeRequested, setIsEmailUpdateCodeRequested] = useState(false);
  const [emailUpdateNotice, setEmailUpdateNotice] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Today');
  const [hasOpenedMaps, setHasOpenedMaps] = useState(false);
  const [riderWorkspace, setRiderWorkspace] = useState<RiderWorkspace | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [isWorkSessionSubmitting, setIsWorkSessionSubmitting] = useState(false);
  const [trips, setTrips] = useState<RiderTrip[]>([]);
  const [isTripsLoading, setIsTripsLoading] = useState(true);
  const [isTripSubmitting, setIsTripSubmitting] = useState(false);
  const [fareAmount, setFareAmount] = useState('');
  const [pendingTripKey, setPendingTripKey] = useState<string | null>(null);
  const [todayLabel] = useState(() => new Intl.DateTimeFormat('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date()).toUpperCase());

  useEffect(() => {
    let mounted = true;
    void restoreSession().then((restored) => {
      if (!mounted) return;
      setSession(restored);
      setIsRestoring(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!session) return () => { mounted = false; };
    void fetchRiderWorkspace(session.accessToken)
      .then((workspace) => {
        if (mounted) setRiderWorkspace(workspace);
      })
      .catch((cause: unknown) => {
        if (mounted) {
          setError(cause instanceof Error
            ? cause.message
            : 'Could not load your rider workday. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (mounted) setIsWorkspaceLoading(false);
      });

    return () => { mounted = false; };
  }, [session]);

  useEffect(() => {
    let mounted = true;
    if (!session) return () => { mounted = false; };
    void fetchRiderTrips(session.accessToken)
      .then((loadedTrips) => {
        if (mounted) setTrips(loadedTrips);
      })
      .catch((cause: unknown) => {
        if (mounted) {
          setError(cause instanceof Error
            ? cause.message
            : 'Could not load your trip history. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (mounted) setIsTripsLoading(false);
      });

    return () => { mounted = false; };
  }, [session]);

  const initials = useMemo(
    () => session?.user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') ?? 'BT',
    [session?.user.fullName],
  );

  async function signIn() {
    setError('');
    setLoginNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(loginMethod === 'email' ? { email, password } : { phoneNumber, password }),
      });
      const result = await response.json() as AuthResponse;
      if (response.status === 202 && result.verificationRequired) {
        setLoginStep('login-code');
        setVerificationCode('');
        setLoginNotice(result.verificationChannel === 'email'
          ? 'A verification code has been sent to your email.'
          : 'A verification code has been sent to your phone.');
        return;
      }
      if (!response.ok || !result.user || !result.accessToken || !result.refreshToken) {
        setError(result.error?.message ?? 'Sign-in failed. Check your email or phone number and password.');
        return;
      }
      await acceptSession(result);
    } catch {
      setError(`Could not reach the sign-in service at ${apiBaseUrl}. Check the phone connection and try again.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function acceptSession(result: AuthResponse) {
    if (!result.user || !result.accessToken || !result.refreshToken) {
      setError('Sign-in did not return a valid session. Please try again.');
      return;
    }
      if (result.user.role !== 'RIDER') {
        await fetch(`${apiBaseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: result.refreshToken }),
        }).catch(() => undefined);
        setError('This app is for rider accounts. Sign in with the rider account created by your SACCO.');
        return;
      }
      const nextSession = result as AuthSession;
      await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(nextSession));
      setSession(nextSession);
      setIsWorkspaceLoading(true);
      setIsTripsLoading(true);
      setTrips([]);
      setPassword('');
      setVerificationCode('');
      setLoginStep('credentials');
      setActiveTab('Today');
  }

  async function verifyLoginCode() {
    setError('');
    setIsSubmitting(true);
    try {
      const emailLogin = loginMethod === 'email';
      const response = await fetch(`${apiBaseUrl}/auth/login/${emailLogin ? 'email/verify' : 'verify'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [emailLogin ? 'email' : 'phoneNumber']: emailLogin ? email : phoneNumber, code: verificationCode }),
      });
      const result = await response.json() as AuthResponse;
      if (!response.ok) {
        setError(result.error?.message ?? 'The code could not be verified. Request a new code and try again.');
        return;
      }
      await acceptSession(result);
    } catch {
      setError('Could not reach the verification service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestActivationCode() {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/email/verification/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not request an activation code. Try again later.');
        return;
      }
      setLoginStep('activation-code');
      setVerificationCode('');
      setLoginNotice('If this email has an invited rider account, an activation code has been sent.');
    } catch {
      setError('Could not reach the activation service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function completeActivation() {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/activation/email/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode, password: newPassword }),
      });
      const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not activate this account. Check the code and try again.');
        return;
      }
      setLoginStep('credentials');
      setPassword('');
      setVerificationCode('');
      setNewPassword('');
      setLoginNotice('Your password is set. Sign in to continue.');
    } catch {
      setError('Could not reach the activation service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestPasswordChangeCode() {
    if (!session) return;
    setError('');
    setPasswordChangeNotice('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/password/change/request`, {
        method: 'POST',
        headers: { authorization: ['Bearer', session.accessToken].join(' ') },
      });
      const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not send a password verification code.');
        return;
      }
      setIsPasswordChangeRequested(true);
      setPasswordChangeCode('');
      setPasswordChangeNotice('A password verification code has been sent to your phone.');
    } catch {
      setError('Could not reach the password service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function completePasswordChange() {
    if (!session) return;
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/password/change/complete`, {
        method: 'POST',
        headers: {
          authorization: ['Bearer', session.accessToken].join(' '),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code: passwordChangeCode, password: passwordChangePassword }),
      });
      const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'Could not change your password. Check the code and try again.');
        return;
      }
      await SecureStore.deleteItemAsync(sessionStorageKey);
      setSession(null);
      setRiderWorkspace(null);
      setIsWorkspaceLoading(false);
      setTrips([]);
      setIsTripsLoading(false);
      setPassword('');
      setPasswordChangePassword('');
      setIsPasswordChangeRequested(false);
      setPasswordChangeNotice('');
      setLoginNotice('Password updated. Sign in with your new password and verify your phone.');
    } catch {
      setError('Could not reach the password service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestEmailConfirmation() {
    if (!session) return;
    setError('');
    setEmailUpdateNotice('');
    setIsSubmitting(true);
    try {
      const addingEmail = !session.user.email && !isEmailUpdateCodeRequested;
      const emailToConfirm = session.user.email ?? emailUpdate.trim().toLowerCase();
      const response = await fetch(
        `${apiBaseUrl}/auth/${addingEmail ? 'email/add' : 'email/verification/request'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(addingEmail ? { authorization: `Bearer ${session.accessToken}` } : {}),
          },
          body: JSON.stringify({ email: emailToConfirm }),
        },
      );
      const result = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      if (!response.ok) {
        if (addingEmail
          && ['EMAIL_UPDATE_DELIVERY_FAILED', 'VERIFICATION_RATE_LIMITED'].includes(result.error?.code ?? '')) {
          const updatedSession: AuthSession = {
            ...session,
            user: { ...session.user, email: emailToConfirm, emailVerified: false },
          };
          await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(updatedSession));
          setSession(updatedSession);
        }
        setError(result.error?.message ?? 'Could not send an email confirmation code.');
        return;
      }
      setEmailUpdate(emailToConfirm);
      setEmailUpdateCode('');
      setIsEmailUpdateCodeRequested(true);
      setEmailUpdateNotice(`A confirmation code was sent to ${emailToConfirm}.`);
    } catch {
      setError('Could not reach the email confirmation service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmAccountEmail() {
    if (!session) return;
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/email/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailUpdate, code: emailUpdateCode }),
      });
      const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? 'The code is invalid or expired. Request another code.');
        return;
      }
      const updatedSession: AuthSession = {
        ...session,
        user: { ...session.user, email: emailUpdate, emailVerified: true },
      };
      await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(updatedSession));
      setSession(updatedSession);
      setIsEmailUpdateCodeRequested(false);
      setEmailUpdateCode('');
      setEmailUpdateNotice('Your email is confirmed and ready for email sign-in.');
    } catch {
      setError('Could not reach the email confirmation service. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    if (!session) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!response.ok) {
        setError('Could not end the server session. Check your connection and try again.');
        return;
      }
      await SecureStore.deleteItemAsync(sessionStorageKey);
      setSession(null);
      setRiderWorkspace(null);
      setIsWorkspaceLoading(false);
      setTrips([]);
      setIsTripsLoading(false);
      setPassword('');
      setError('');
    } catch {
      setError('Could not reach the sign-in service. Reconnect and try signing out again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeWorkSession(action: 'start' | 'end') {
    if (!session || (action === 'start' && !riderWorkspace?.assignment)) return;
    if (action === 'end' && !riderWorkspace?.workSession) return;
    setError('');
    setIsWorkSessionSubmitting(true);
    try {
      const path = action === 'start'
        ? `${apiBaseUrl}/work-sessions/start`
        : `${apiBaseUrl}/work-sessions/${encodeURIComponent(riderWorkspace?.workSession?.id ?? '')}/end`;
      const response = await fetch(path, {
        method: 'POST',
        headers: { authorization: ['Bearer', session.accessToken].join(' ') },
      });
      const result = await response.json() as {
        data?: WorkSession;
        error?: { message?: string };
      };
      if (!response.ok || !result.data) {
        setError(result.error?.message ?? 'Could not update your work session. Try again.');
        return;
      }
      setRiderWorkspace((current) => current
        ? { ...current, workSession: action === 'start' ? result.data ?? null : null }
        : current);
    } catch {
      setError('Could not reach the workday service. Check your connection and try again.');
    } finally {
      setIsWorkSessionSubmitting(false);
    }
  }

  async function startTrip() {
    if (!session || !riderWorkspace?.workSession || trips.some((trip) => trip.status === 'IN_PROGRESS')) return;
    setError('');
    setIsTripSubmitting(true);
    const idempotencyKey = pendingTripKey ?? createTripIdempotencyKey();
    setPendingTripKey(idempotencyKey);
    try {
      const response = await fetch(`${apiBaseUrl}/trips/start`, {
        method: 'POST',
        headers: {
          authorization: ['Bearer', session.accessToken].join(' '),
          'Idempotency-Key': idempotencyKey,
        },
      });
      const result = await response.json() as { data?: RiderTrip; error?: { message?: string } };
      if (!response.ok || !result.data) {
        setError(result.error?.message ?? 'Could not start this trip. Try again.');
        return;
      }
      const startedTrip = result.data;
      setTrips((current) => [startedTrip, ...current.filter((trip) => trip.id !== startedTrip.id)]);
      setPendingTripKey(null);
      setHasOpenedMaps(true);
      setActiveTab('Maps');
    } catch {
      setError('The trip start could not be confirmed. Retry to safely check the same request.');
    } finally {
      setIsTripSubmitting(false);
    }
  }

  async function completeTrip(tripId: string) {
    if (!session || !fareAmount.trim()) return;
    setError('');
    setIsTripSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/complete`, {
        method: 'POST',
        headers: {
          authorization: ['Bearer', session.accessToken].join(' '),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ fareAmount: fareAmount.trim() }),
      });
      const result = await response.json() as { data?: RiderTrip; error?: { message?: string } };
      if (!response.ok || !result.data) {
        setError(result.error?.message ?? 'Could not complete this trip. Check the fare and try again.');
        return;
      }
      const completedTrip = result.data;
      setTrips((current) => current.map((trip) => trip.id === completedTrip.id ? completedTrip : trip));
      setFareAmount('');
    } catch {
      setError('The trip completion could not be confirmed. Retry with the same fare.');
    } finally {
      setIsTripSubmitting(false);
    }
  }

  if (isRestoring) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <View style={styles.brandMark}><Text style={styles.brandLetter}>B</Text></View>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Preparing your rider account…</Text>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        error={error}
        loginNotice={loginNotice}
        loginStep={loginStep}
        isSubmitting={isSubmitting}
        password={password}
        email={email}
        loginMethod={loginMethod}
        setEmail={setEmail}
        setLoginMethod={setLoginMethod}
        phoneNumber={phoneNumber}
        setPassword={setPassword}
        setPhoneNumber={setPhoneNumber}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        verificationCode={verificationCode}
        setVerificationCode={setVerificationCode}
        setLoginStep={setLoginStep}
        signIn={() => void signIn()}
        verifyLoginCode={() => void verifyLoginCode()}
        requestActivationCode={() => void requestActivationCode()}
        completeActivation={() => void completeActivation()}
      />
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandMarkSmall}><Text style={styles.brandLetterSmall}>B</Text></View>
          <Text style={styles.brandName}>Boda-Tracker</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === 'Today' && (
          <TodayScreen
            dateLabel={todayLabel}
            isLoading={isWorkspaceLoading}
            isSubmitting={isWorkSessionSubmitting}
            onEndShift={() => void changeWorkSession('end')}
            onStartShift={() => void changeWorkSession('start')}
            session={session}
            setActiveTab={setActiveTab}
            workspace={riderWorkspace}
          />
        )}
        {activeTab === 'Trips' && (
          <TripsScreen
            fareAmount={fareAmount}
            isLoading={isTripsLoading}
            isShiftActive={Boolean(riderWorkspace?.workSession)}
            isSubmitting={isTripSubmitting}
            onCompleteTrip={(tripId) => void completeTrip(tripId)}
            onStartTrip={() => void startTrip()}
            setFareAmount={setFareAmount}
            trips={trips}
          />
        )}
        {hasOpenedMaps && (
          <View style={{ display: activeTab === 'Maps' ? 'flex' : 'none' }}>
          <MapsScreen
            activeTrip={trips.find((trip) => trip.status === 'IN_PROGRESS') ?? null}
            accessToken={session.accessToken}
            isVisible={activeTab === 'Maps'}
          />
          </View>
        )}
        {activeTab === 'Account' && (
          <AccountScreen
            error={error}
            isSubmitting={isSubmitting}
            isPasswordChangeRequested={isPasswordChangeRequested}
            passwordChangeCode={passwordChangeCode}
            passwordChangePassword={passwordChangePassword}
            passwordChangeNotice={passwordChangeNotice}
            emailUpdate={emailUpdate}
            emailUpdateCode={emailUpdateCode}
            emailUpdateNotice={emailUpdateNotice}
            isEmailUpdateCodeRequested={isEmailUpdateCodeRequested}
            session={session}
            requestPasswordChangeCode={() => void requestPasswordChangeCode()}
            completePasswordChange={() => void completePasswordChange()}
            setPasswordChangeCode={setPasswordChangeCode}
            setPasswordChangePassword={setPasswordChangePassword}
            setEmailUpdate={setEmailUpdate}
            setEmailUpdateCode={setEmailUpdateCode}
            requestEmailConfirmation={() => void requestEmailConfirmation()}
            confirmAccountEmail={() => void confirmAccountEmail()}
            cancelPasswordChange={() => {
              setIsPasswordChangeRequested(false);
              setPasswordChangeCode('');
              setPasswordChangePassword('');
              setPasswordChangeNotice('');
              setError('');
            }}
            signOut={() => void signOut()}
          />
        )}
        {error && activeTab !== 'Account' && (
          <Text accessibilityRole="alert" style={styles.inlineError}>{error}</Text>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {([
          ['Today', '⌂'],
          ['Trips', '↗'],
          ['Maps', '⌖'],
          ['Account', '○'],
        ] as const).map(([tab, icon]) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            key={tab}
            onPress={() => {
              setActiveTab(tab);
              if (tab === 'Maps') setHasOpenedMaps(true);
              setError('');
            }}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
          >
            <Text style={[styles.tabIcon, activeTab === tab && styles.tabIconActive]}>{icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>{tab}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function LoginScreen({
  error,
  loginNotice,
  loginStep,
  isSubmitting,
  password,
  email,
  loginMethod,
  newPassword,
  phoneNumber,
  verificationCode,
  setLoginStep,
  setEmail,
  setLoginMethod,
  setNewPassword,
  setPassword,
  setPhoneNumber,
  setVerificationCode,
  signIn,
  verifyLoginCode,
  requestActivationCode,
  completeActivation,
}: {
  error: string;
  loginNotice: string;
  loginStep: LoginStep;
  isSubmitting: boolean;
  password: string;
  email: string;
  loginMethod: LoginMethod;
  newPassword: string;
  phoneNumber: string;
  verificationCode: string;
  setLoginStep: (step: LoginStep) => void;
  setNewPassword: (value: string) => void;
  setPassword: (value: string) => void;
  setPhoneNumber: (value: string) => void;
  setEmail: (value: string) => void;
  setLoginMethod: (method: LoginMethod) => void;
  setVerificationCode: (value: string) => void;
  signIn: () => void;
  verifyLoginCode: () => void;
  requestActivationCode: () => void;
  completeActivation: () => void;
}) {
  return (
    <SafeAreaView style={styles.loginScreen}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.loginKeyboard}
      >
        <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
          <View style={styles.loginBrand}>
            <View style={styles.brandMark}><Text style={styles.brandLetter}>B</Text></View>
            <Text style={styles.loginBrandName}>Boda-Tracker</Text>
          </View>

          <View style={styles.loginIntro}>
            <Text style={styles.eyebrow}>RIDER APP · KENYA</Text>
            <Text style={styles.loginTitle}>
              {loginStep === 'credentials'
                ? 'Your day starts here.'
                : loginStep.startsWith('activation')
                  ? 'Activate your account.'
                  : `Verify your ${loginMethod === 'email' ? 'email' : 'phone'}.`}
            </Text>
            <Text style={styles.loginDescription}>
              {loginStep === 'credentials'
                ? loginMethod === 'email'
                  ? 'Sign in with your email and password. A verification code will be sent to your email.'
                  : 'Sign in with your phone number and password. A verification code will be sent to your phone.'
                : loginStep.startsWith('activation')
                  ? 'Set up your rider account using the activation code sent to your email.'
                  : `Enter the six-digit code sent to your ${loginMethod === 'email' ? 'email' : 'phone'} to finish signing in.`}
            </Text>
          </View>

          <View style={styles.loginCard}>
            {(loginStep === 'credentials' || loginStep === 'activation-email') && (
              <>
                {loginStep === 'activation-email' || loginMethod === 'email' ? (
                  <>
                    <Text style={styles.fieldLabel}>Email address</Text>
                    <TextInput
                      accessibilityLabel="Email address"
                      autoComplete="email"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      onChangeText={setEmail}
                      placeholder="name@example.com"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                      value={email}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Phone number</Text>
                    <TextInput
                      accessibilityLabel="Phone number"
                      autoComplete="tel"
                      autoCapitalize="none"
                      keyboardType="phone-pad"
                      onChangeText={setPhoneNumber}
                      placeholder="+254 7XX XXX XXX"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                      value={phoneNumber}
                    />
                  </>
                )}
              </>
            )}
            {loginStep === 'credentials' && (
              <>
                <Text style={[styles.fieldLabel, styles.passwordLabel]}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete="current-password"
                  onChangeText={setPassword}
                  onSubmitEditing={signIn}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={styles.input}
                  value={password}
                />
              </>
            )}
            {(loginStep === 'login-code' || loginStep === 'activation-code') && (
              <>
                <Text style={styles.fieldLabel}>Six-digit code</Text>
                <TextInput
                  accessibilityLabel="Six-digit verification code"
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={setVerificationCode}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={verificationCode}
                />
              </>
            )}
            {loginStep === 'activation-code' && (
              <>
                <Text style={[styles.fieldLabel, styles.passwordLabel]}>Create a password</Text>
                <TextInput
                  accessibilityLabel="Create a password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  maxLength={128}
                  onChangeText={setNewPassword}
                  placeholder="At least 14 characters"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={styles.input}
                  value={newPassword}
                />
              </>
            )}
            {loginNotice ? <Text style={styles.loginNotice}>{loginNotice}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={styles.loginError}>{error}</Text> : null}
            {loginStep === 'credentials' && (
              <>
                <LoginAction
                  label="Sign in  →"
                  disabled={isSubmitting || !(loginMethod === 'email' ? email.trim() : phoneNumber.trim()) || !password}
                  isSubmitting={isSubmitting}
                  onPress={signIn}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLoginMethod(loginMethod === 'email' ? 'phone' : 'email')}
                  style={styles.loginSecondaryButton}
                >
                  <Text style={styles.loginSecondaryText}>
                    {loginMethod === 'email' ? 'Use phone number instead' : 'Use email instead'}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setLoginStep('activation-email')} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Activate a new rider account</Text>
                </Pressable>
                <Text style={styles.loginHelp}>Email sign-in is preferred. Phone sign-in remains available.</Text>
              </>
            )}
            {loginStep === 'login-code' && (
              <>
                <LoginAction
                  label="Verify and sign in"
                  disabled={isSubmitting || verificationCode.length !== 6}
                  isSubmitting={isSubmitting}
                  onPress={verifyLoginCode}
                />
                <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={signIn} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Resend code</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => { setLoginStep('credentials'); setVerificationCode(''); }} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Back to sign in</Text>
                </Pressable>
              </>
            )}
            {loginStep === 'activation-email' && (
              <>
                <LoginAction
                  label="Send activation code"
                  disabled={isSubmitting || !email.trim()}
                  isSubmitting={isSubmitting}
                  onPress={requestActivationCode}
                />
                <Pressable accessibilityRole="button" onPress={() => setLoginStep('credentials')} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Back to sign in</Text>
                </Pressable>
              </>
            )}
            {loginStep === 'activation-code' && (
              <>
                <LoginAction
                  label="Set password and continue"
                  disabled={isSubmitting || verificationCode.length !== 6 || newPassword.length < 14}
                  isSubmitting={isSubmitting}
                  onPress={completeActivation}
                />
                <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={requestActivationCode} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Resend activation code</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setLoginStep('credentials')} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryText}>Back to sign in</Text>
                </Pressable>
              </>
            )}
          </View>
          <Text style={styles.loginFooter}>Secure access for your transport workday</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LoginAction({
  label,
  disabled,
  isSubmitting,
  onPress,
}: {
  label: string;
  disabled: boolean;
  isSubmitting: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {isSubmitting
        ? <ActivityIndicator color={colors.white} />
        : <Text style={styles.primaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function TodayScreen({
  dateLabel,
  isLoading,
  isSubmitting,
  onEndShift,
  onStartShift,
  session,
  setActiveTab,
  workspace,
}: {
  dateLabel: string;
  isLoading: boolean;
  isSubmitting: boolean;
  onEndShift: () => void;
  onStartShift: () => void;
  session: AuthSession;
  setActiveTab: (tab: Tab) => void;
  workspace: RiderWorkspace | null;
}) {
  const firstName = session.user.fullName.trim().split(/\s+/)[0] || 'Rider';

  return (
    <View>
      <Text style={styles.dateLabel}>{dateLabel}</Text>
      <Text style={styles.greeting}>Habari, {firstName}</Text>
      <Text style={styles.pageSubtitle}>Your rider workspace</Text>

      <View style={styles.welcomeCard}>
        <View style={styles.welcomeTop}>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>ACCOUNT ACTIVE</Text>
          </View>
        </View>
        <Text style={styles.welcomeTitle}>Karibu kazini.</Text>
        <Text style={styles.welcomeBody}>
          {session.user.saccoName
            ? `You’re signed in to ${session.user.saccoName}.`
            : 'You’re signed in to your rider account.'}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Your workspace</Text>
      <Pressable onPress={() => setActiveTab('Trips')} style={styles.featureCard}>
        <View style={[styles.featureIcon, { backgroundColor: colors.primarySoft }]}>
          <Text style={styles.featureIconText}>↗</Text>
        </View>
        <View style={styles.featureCopy}>
          <Text style={styles.featureTitle}>Trips</Text>
          <Text style={styles.featureDescription}>Your trip history and daily activity</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <View style={styles.workdayCard}>
        <Text style={styles.workdayTitle}>Your workday</Text>
        {isLoading ? (
          <View style={styles.workdayLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.workdayDescription}>Loading your rider assignment…</Text>
          </View>
        ) : workspace?.workSession ? (
          <>
            <Text style={styles.workdayVehicle}>
              {workspace.workSession.vehicle.registrationNumber} · {workspace.workSession.vehicle.type}
            </Text>
            <Text style={styles.workdayDescription}>
              Shift started {new Date(workspace.workSession.startedAt).toLocaleTimeString('en-KE', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={onEndShift}
              style={({ pressed }) => [styles.workdayButton, styles.endShiftButton, pressed && styles.buttonPressed]}
            >
              {isSubmitting
                ? <ActivityIndicator color={colors.red} />
                : <Text style={styles.endShiftButtonText}>End shift</Text>}
            </Pressable>
          </>
        ) : workspace?.assignment ? (
          <>
            <Text style={styles.workdayVehicle}>
              {workspace.assignment.vehicle.registrationNumber} · {workspace.assignment.vehicle.type}
            </Text>
            <Text style={styles.workdayDescription}>This vehicle is assigned to you.</Text>
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={onStartShift}
              style={({ pressed }) => [styles.workdayButton, styles.startShiftButton, pressed && styles.buttonPressed]}
            >
              {isSubmitting
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.startShiftButtonText}>Start shift</Text>}
            </Pressable>
          </>
        ) : (
          <Text style={styles.workdayDescription}>
            No vehicle is assigned to you yet. Ask your SACCO administrator to assign one before starting a shift.
          </Text>
        )}
      </View>

      <View style={styles.setupCard}>
        <Text style={styles.setupTitle}>Getting started</Text>
        <View style={styles.setupRow}>
          <View style={styles.setupCheck}><Text style={styles.setupCheckText}>✓</Text></View>
          <View style={styles.setupCopy}>
            <Text style={styles.setupStepTitle}>Rider account</Text>
            <Text style={styles.setupStepBody}>Your sign-in is active and secure</Text>
          </View>
          <Text style={styles.stepDone}>DONE</Text>
        </View>
        <View style={styles.setupDivider} />
        <View style={styles.setupRow}>
          <View style={workspace?.assignment ? styles.setupCheck : styles.setupPending}>
            <Text style={workspace?.assignment ? styles.setupCheckText : styles.setupPendingText}>
              {workspace?.assignment ? '✓' : '2'}
            </Text>
          </View>
          <View style={styles.setupCopy}>
            <Text style={styles.setupStepTitle}>Vehicle & shift</Text>
            <Text style={styles.setupStepBody}>
              {workspace?.workSession
                ? 'Your shift is active'
                : workspace?.assignment
                  ? 'Your vehicle is assigned and ready'
                  : 'Ask your SACCO admin to assign your vehicle'}
            </Text>
          </View>
          <Text style={workspace?.workSession || workspace?.assignment ? styles.stepDone : styles.stepWait}>
            {workspace?.workSession ? 'ACTIVE' : workspace?.assignment ? 'READY' : 'NEXT'}
          </Text>
        </View>
      </View>

      <Text style={styles.safeNote}>Your information is only visible to you and your SACCO.</Text>
    </View>
  );
}

function TripsScreen({
  fareAmount,
  isLoading,
  isShiftActive,
  isSubmitting,
  onCompleteTrip,
  onStartTrip,
  setFareAmount,
  trips,
}: {
  fareAmount: string;
  isLoading: boolean;
  isShiftActive: boolean;
  isSubmitting: boolean;
  onCompleteTrip: (tripId: string) => void;
  onStartTrip: () => void;
  setFareAmount: (value: string) => void;
  trips: RiderTrip[];
}) {
  const activeTrip = trips.find((trip) => trip.status === 'IN_PROGRESS');
  const completedTrips = trips.filter((trip) => trip.status === 'COMPLETED');

  return (
    <View>
      <Text style={styles.dateLabel}>YOUR ACTIVITY</Text>
      <Text style={styles.greeting}>Trips</Text>
      <Text style={styles.pageSubtitle}>Record each trip and its fare</Text>

      <View style={styles.tripActionCard}>
        <Text style={styles.workdayTitle}>{activeTrip ? 'Trip in progress' : 'Record a trip'}</Text>
        {activeTrip ? (
          <>
            <Text style={styles.tripVehicle}>
              {activeTrip.vehicle.registrationNumber} · Started {formatTripTime(activeTrip.startedAt)}
            </Text>
            <Text style={styles.fieldLabel}>Fare collected (KES)</Text>
            <TextInput
              accessibilityLabel="Fare collected in Kenyan shillings"
              keyboardType="decimal-pad"
              onChangeText={setFareAmount}
              placeholder="e.g. 150.00"
              placeholderTextColor={colors.muted}
              style={styles.tripFareInput}
              value={fareAmount}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || !fareAmount.trim()}
              onPress={() => onCompleteTrip(activeTrip.id)}
              style={({ pressed }) => [
                styles.tripPrimaryButton,
                (isSubmitting || !fareAmount.trim()) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              {isSubmitting
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.primaryButtonText}>Save fare & complete trip</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.tripActionDescription}>
              {isShiftActive
                ? 'Start a trip when you pick up a passenger. You can enter the fare when the trip ends.'
                : 'Start your work shift before recording a trip.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || !isShiftActive || isLoading}
              onPress={onStartTrip}
              style={({ pressed }) => [
                styles.tripPrimaryButton,
                (!isShiftActive || isLoading) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              {isSubmitting
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.primaryButtonText}>Start trip</Text>}
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>Recent trips</Text>
      {isLoading ? (
        <View style={styles.tripLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.tripActionDescription}>Loading your trip history…</Text>
        </View>
      ) : completedTrips.length ? (
        completedTrips.map((trip) => (
          <View key={trip.id} style={styles.tripHistoryCard}>
            <View style={styles.tripHistoryTop}>
              <Text style={styles.tripHistoryVehicle}>{trip.vehicle.registrationNumber}</Text>
              <Text style={styles.tripFareValue}>KES {formatFare(trip.fareAmount)}</Text>
            </View>
            <Text style={styles.tripHistoryDate}>{formatTripDate(trip.startedAt)}</Text>
          </View>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>↗</Text></View>
          <Text style={styles.emptyTitle}>No completed trips yet</Text>
          <Text style={styles.emptyBody}>Your recorded trips and fares will appear here.</Text>
        </View>
      )}
    </View>
  );
}

function MapsScreen({
  accessToken,
  activeTrip,
  isVisible,
}: {
  accessToken: string;
  activeTrip: RiderTrip | null;
  isVisible: boolean;
}) {
  const cameraRef = useRef<CameraRef>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const [currentLocation, setCurrentLocation] = useState<MapCoordinate | null>(null);
  const [destination, setDestination] = useState<PlaceDestination | null>(null);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isVisible) return;
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    setIsLocationTracking(false);
  }, [isVisible]);

  useEffect(() => () => {
    locationSubscriptionRef.current?.remove();
  }, []);

  useEffect(() => {
    const input = searchText.trim();
    if (input.length < 3) return undefined;

    let active = true;
    const timer = setTimeout(() => {
      void fetch(`${apiBaseUrl}/maps/places?input=${encodeURIComponent(input)}`, {
        headers: { authorization: ['Bearer', accessToken].join(' ') },
      }).then(async (response) => {
        const result = await response.json() as {
          data?: PlaceSuggestion[];
          error?: { message?: string };
        };
        if (!response.ok || !result.data) {
          throw new Error(result.error?.message ?? 'Could not search places. Try again.');
        }
        if (active) {
          setSuggestions(result.data);
          setError('');
        }
      }).catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not search places. Check your connection.');
        }
      });
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessToken, searchText]);

  async function getCurrentLocation() {
    setError('');
    setIsLocationLoading(true);
    try {
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      setIsLocationTracking(false);

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location permission is needed to calculate a route from where you are.');
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let receivedFirstFix = false;
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          locationSubscriptionRef.current?.remove();
          locationSubscriptionRef.current = null;
          reject(new Error('LOCATION_TIMEOUT'));
        }, 15_000);

        void Location.watchPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 5,
          timeInterval: 2_000,
        }, (position) => {
          if (timedOut || Date.now() - position.timestamp > 60_000) return;

          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setCurrentLocation(location);

          if (!receivedFirstFix) {
            receivedFirstFix = true;
            clearTimeout(timeout);
            cameraRef.current?.easeTo({
              center: [location.longitude, location.latitude],
              zoom: 14,
              duration: 450,
            });
            setRoutes([]);
            setSelectedRouteId(null);
            setIsLocationTracking(true);
            resolve();
          }
        }).then((subscription) => {
          if (timedOut) {
            subscription.remove();
            return;
          }
          locationSubscriptionRef.current?.remove();
          locationSubscriptionRef.current = subscription;
        }, (cause: unknown) => {
          clearTimeout(timeout);
          if (!receivedFirstFix) reject(cause);
        });
      });
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'LOCATION_TIMEOUT'
        ? 'No live GPS fix arrived within 15 seconds. Check that the emulator has a fresh location and try again.'
        : 'Could not get your location. Check that location services are enabled and try again.');
    } finally {
      setIsLocationLoading(false);
    }
  }

  function chooseMapDestination(event: NativeSyntheticEvent<PressEvent>) {
    if (!activeTrip) {
      setError('Start a trip before choosing a destination.');
      return;
    }
    const [longitude, latitude] = event.nativeEvent.lngLat;
    setDestination({ latitude, longitude, name: 'Pinned map location' });
    setSearchText('');
    setSuggestions([]);
    setRoutes([]);
    setSelectedRouteId(null);
    setError('');
  }

  function choosePlace(suggestion: PlaceSuggestion) {
    setError('');
    const selectedDestination = {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      name: suggestion.description,
    };
    setDestination(selectedDestination);
    cameraRef.current?.easeTo({
      center: [suggestion.longitude, suggestion.latitude],
      zoom: 14,
      duration: 450,
    });
    setSearchText('');
    setSuggestions([]);
    setRoutes([]);
    setSelectedRouteId(null);
  }

  async function findRoutes() {
    if (!currentLocation || !destination) {
      setError('Choose a destination and allow access to your current location first.');
      return;
    }
    setError('');
    setIsRouteLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/maps/routes`, {
        method: 'POST',
        headers: {
          authorization: ['Bearer', accessToken].join(' '),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ origin: currentLocation, destination }),
      });
      const result = await response.json() as {
        data?: RouteOption[];
        error?: { message?: string };
      };
      if (!response.ok || !result.data) {
        setError(result.error?.message ?? 'Could not calculate a preview route. Try again.');
        return;
      }
      if (!result.data.length) {
        setRoutes([]);
        setSelectedRouteId(null);
        setError('The public routing service could not find a route for these locations.');
        return;
      }
      setRoutes(result.data);
      setSelectedRouteId(result.data[0].id);
    } catch {
      setError('Could not calculate a route. Check your connection and try again.');
    } finally {
      setIsRouteLoading(false);
    }
  }

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;
  const routeCoordinates = useMemo(
    () => selectedRoute ? decodePolyline(selectedRoute.encodedPolyline) : [],
    [selectedRoute],
  );
  const destinationGeoJson = useMemo<FeatureCollection<Point>>(() => ({
    type: 'FeatureCollection',
    features: destination ? [{
      type: 'Feature',
      properties: { name: destination.name },
      geometry: {
        type: 'Point',
        coordinates: [destination.longitude, destination.latitude],
      },
    }] : [],
  }), [destination]);
  const currentLocationGeoJson = useMemo<FeatureCollection<Point>>(() => ({
    type: 'FeatureCollection',
    features: currentLocation ? [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [currentLocation.longitude, currentLocation.latitude],
      },
    }] : [],
  }), [currentLocation]);
  const routeGeoJson = useMemo<FeatureCollection<LineString>>(() => ({
    type: 'FeatureCollection',
    features: routeCoordinates.length > 1 ? [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates.map(({ latitude, longitude }) => [longitude, latitude]),
      },
    }] : [],
  }), [routeCoordinates]);
  const visibleSuggestions = searchText.trim().length >= 3 ? suggestions : [];

  useEffect(() => {
    if (routeCoordinates.length < 2) return;
    const longitudes = routeCoordinates.map(({ longitude }) => longitude);
    const latitudes = routeCoordinates.map(({ latitude }) => latitude);
    cameraRef.current?.fitBounds(
      [
        Math.min(...longitudes),
        Math.min(...latitudes),
        Math.max(...longitudes),
        Math.max(...latitudes),
      ],
      {
        padding: { top: 45, right: 45, bottom: 45, left: 45 },
        duration: 500,
      },
    );
  }, [routeCoordinates]);

  return (
    <View>
      <Text style={styles.dateLabel}>RIDER NAVIGATION</Text>
      <Text style={styles.greeting}>Maps</Text>
      <Text style={styles.pageSubtitle}>Choose a destination and preview a road route</Text>

      <View style={styles.mapNotice}>
        <Text style={styles.mapNoticeTitle}>
          {activeTrip ? `Trip in progress · ${activeTrip.vehicle.registrationNumber}` : 'Start a trip to plan your route'}
        </Text>
        <Text style={styles.mapNoticeBody}>
          {activeTrip
            ? 'Choose a destination by searching or tapping the map.'
            : 'When you start a trip, you can search for a place or tap any point on the map.'}
        </Text>
        <Text style={styles.mapNoticeBody}>
          Map tiles come from OpenStreetMap; search text goes to Photon and route coordinates go to OSRM. These public providers process requests under their own policies; Boda-Tracker does not store them. Route previews use a car profile, not motorcycle navigation.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isLocationLoading}
        onPress={() => {
          if (isLocationTracking) {
            locationSubscriptionRef.current?.remove();
            locationSubscriptionRef.current = null;
            setIsLocationTracking(false);
            return;
          }
          void getCurrentLocation();
        }}
        style={({ pressed }) => [styles.mapLocationButton, pressed && styles.buttonPressed]}
      >
        {isLocationLoading
          ? <ActivityIndicator color={colors.primary} />
          : <Text style={styles.mapLocationButtonText}>
            {isLocationTracking ? 'Stop live location' : currentLocation ? 'Resume live location' : 'Use my current location'}
          </Text>}
      </Pressable>
      {isLocationTracking && (
        <Text style={styles.mapLocationStatus}>Live location updates are on while this map is open.</Text>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.loginError}>{error}</Text> : null}

      <TextInput
        accessibilityLabel="Search for a destination"
        editable={Boolean(activeTrip)}
        onChangeText={(value) => { setSearchText(value); setSuggestions([]); }}
        placeholder="Search a place or address"
        placeholderTextColor={colors.muted}
        style={[styles.tripFareInput, !activeTrip && styles.inputDisabled]}
        value={searchText}
      />
      {visibleSuggestions.map((suggestion) => (
        <Pressable
          accessibilityRole="button"
          key={suggestion.placeId}
          onPress={() => void choosePlace(suggestion)}
          style={({ pressed }) => [styles.placeSuggestion, pressed && styles.buttonPressed]}
        >
          <Text style={styles.placeSuggestionText}>{suggestion.description}</Text>
        </Pressable>
      ))}
      <View style={styles.mapContainer}>
        <MapLibreMap
          attribution={false}
          compass
          logo={false}
          mapStyle={osmMapStyle}
          onPress={chooseMapDestination}
          onDidFailLoadingMap={() => setError('Could not load OpenStreetMap tiles. Check your connection and try again.')}
          style={styles.mapView}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: [nairobiCoordinate.longitude, nairobiCoordinate.latitude],
              zoom: 11,
            }}
          />
          <GeoJSONSource id="current-location-source" data={currentLocationGeoJson}>
            <Layer
              id="current-location-layer"
              type="circle"
              paint={{
                'circle-color': colors.primary,
                'circle-radius': 6,
                'circle-stroke-color': colors.white,
                'circle-stroke-width': 2,
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="destination-source" data={destinationGeoJson}>
            <Layer
              id="destination-layer"
              type="circle"
              paint={{
                'circle-color': colors.red,
                'circle-radius': 9,
                'circle-stroke-color': colors.white,
                'circle-stroke-width': 2,
              }}
            />
          </GeoJSONSource>
          <GeoJSONSource id="route-source" data={routeGeoJson}>
            <Layer
              id="route-layer"
              type="line"
              paint={{
                'line-color': colors.accent,
                'line-width': 5,
                'line-opacity': 0.9,
              }}
            />
          </GeoJSONSource>
        </MapLibreMap>
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL('https://www.openstreetmap.org/copyright')
              .catch(() => setError('Could not open OpenStreetMap attribution information.'));
          }}
          style={styles.mapAttribution}
        >
          <Text style={styles.mapAttributionText}>© OpenStreetMap contributors</Text>
        </Pressable>
      </View>

      {destination && (
        <View style={styles.destinationCard}>
          <Text style={styles.destinationLabel}>DESTINATION</Text>
          <Text style={styles.destinationName}>{destination.name}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!activeTrip || !currentLocation || !destination || isRouteLoading}
        onPress={() => void findRoutes()}
        style={({ pressed }) => [
          styles.tripPrimaryButton,
          (!activeTrip || !currentLocation || !destination || isRouteLoading) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        {isRouteLoading
          ? <ActivityIndicator color={colors.white} />
          : <Text style={styles.primaryButtonText}>Find preview route</Text>}
      </Pressable>

      {routes.map((route, index) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: route.id === selectedRouteId }}
          key={route.id}
          onPress={() => setSelectedRouteId(route.id)}
          style={[
            styles.routeCard,
            route.id === selectedRouteId && styles.routeCardSelected,
          ]}
        >
          <View style={styles.tripHistoryTop}>
            <Text style={styles.tripHistoryVehicle}>{index === 0 ? 'Shortest returned option' : `Route option ${index + 1}`}</Text>
            <Text style={styles.tripFareValue}>{formatDistance(route.distanceMeters)}</Text>
          </View>
          <Text style={styles.tripHistoryDate}>About {formatDuration(route.durationSeconds)} · tap to show on map</Text>
        </Pressable>
      ))}

      <Text style={styles.mapDisclaimer}>
        Prototype only: routes use a public car-driving profile, not motorcycle routing, and may be incomplete or unavailable. Do not rely on these routes for real rides. Follow road signs and never use the app while riding.
      </Text>
    </View>
  );
}

function AccountScreen({
  error,
  isSubmitting,
  isPasswordChangeRequested,
  passwordChangeCode,
  passwordChangePassword,
  passwordChangeNotice,
  emailUpdate,
  emailUpdateCode,
  emailUpdateNotice,
  isEmailUpdateCodeRequested,
  session,
  requestPasswordChangeCode,
  completePasswordChange,
  setPasswordChangeCode,
  setPasswordChangePassword,
  setEmailUpdate,
  setEmailUpdateCode,
  requestEmailConfirmation,
  confirmAccountEmail,
  cancelPasswordChange,
  signOut,
}: {
  error: string;
  isSubmitting: boolean;
  isPasswordChangeRequested: boolean;
  passwordChangeCode: string;
  passwordChangePassword: string;
  passwordChangeNotice: string;
  emailUpdate: string;
  emailUpdateCode: string;
  emailUpdateNotice: string;
  isEmailUpdateCodeRequested: boolean;
  session: AuthSession;
  requestPasswordChangeCode: () => void;
  completePasswordChange: () => void;
  setPasswordChangeCode: (value: string) => void;
  setPasswordChangePassword: (value: string) => void;
  setEmailUpdate: (value: string) => void;
  setEmailUpdateCode: (value: string) => void;
  requestEmailConfirmation: () => void;
  confirmAccountEmail: () => void;
  cancelPasswordChange: () => void;
  signOut: () => void;
}) {
  return (
    <View>
      <Text style={styles.dateLabel}>YOUR DETAILS</Text>
      <Text style={styles.greeting}>Account</Text>
      <Text style={styles.pageSubtitle}>Your Boda-Tracker profile</Text>
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileInitials}>
            {session.user.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}
          </Text>
        </View>
        <Text style={styles.profileName}>{session.user.fullName}</Text>
        <Text style={styles.profileRole}>RIDER ACCOUNT</Text>
      </View>
      <View style={styles.detailsCard}>
        <DetailRow label="Email" value={session.user.email ?? 'Not set'} />
        <View style={styles.detailDivider} />
        <DetailRow label="Phone number" value={session.user.phoneNumber} />
        <View style={styles.detailDivider} />
        <DetailRow label="SACCO" value={session.user.saccoName ?? 'Not linked'} />
        <View style={styles.detailDivider} />
        <DetailRow label="Account status" value="Active" />
      </View>
      <View style={styles.passwordChangeCard}>
        <Text style={styles.fieldLabel}>Email sign-in</Text>
        <Text style={styles.passwordChangeDescription}>
          {session.user.emailVerified
            ? 'Your email is confirmed. Use it as your preferred sign-in method.'
            : 'Confirm your email to use it as the preferred sign-in method.'}
        </Text>
        {emailUpdateNotice ? <Text style={styles.loginNotice}>{emailUpdateNotice}</Text> : null}
        {!session.user.email && !isEmailUpdateCodeRequested && (
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmailUpdate}
            placeholder="name@example.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={emailUpdate}
          />
        )}
        {isEmailUpdateCodeRequested && (
          <TextInput
            accessibilityLabel="Email confirmation code"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setEmailUpdateCode}
            placeholder="Six-digit code"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={emailUpdateCode}
          />
        )}
        {!session.user.emailVerified && (
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || (isEmailUpdateCodeRequested && emailUpdateCode.length !== 6) || (!session.user.email && !emailUpdate.trim())}
            onPress={isEmailUpdateCodeRequested ? confirmAccountEmail : requestEmailConfirmation}
            style={({ pressed }) => [styles.passwordChangeButton, pressed && styles.buttonPressed]}
          >
            {isSubmitting
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={styles.passwordChangeButtonText}>
                {isEmailUpdateCodeRequested ? 'Confirm email' : session.user.email ? 'Send confirmation code' : 'Add email and send code'}
              </Text>}
          </Pressable>
        )}
        {isEmailUpdateCodeRequested && (
          <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={requestEmailConfirmation} style={styles.loginSecondaryButton}>
            <Text style={styles.loginSecondaryText}>Resend code</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.passwordChangeCard}>
        <Text style={styles.fieldLabel}>Password security</Text>
        <Text style={styles.passwordChangeDescription}>
          Confirm the code sent to your phone before changing your password.
        </Text>
        {passwordChangeNotice ? <Text style={styles.loginNotice}>{passwordChangeNotice}</Text> : null}
        {isPasswordChangeRequested ? (
          <>
            <TextInput
              accessibilityLabel="Password verification code"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setPasswordChangeCode}
              placeholder="Six-digit code"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={passwordChangeCode}
            />
            <TextInput
              accessibilityLabel="New password"
              autoCapitalize="none"
              autoComplete="new-password"
              maxLength={128}
              onChangeText={setPasswordChangePassword}
              placeholder="New password (at least 14 characters)"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={passwordChangePassword}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || passwordChangeCode.length !== 6 || passwordChangePassword.length < 14}
              onPress={completePasswordChange}
              style={({ pressed }) => [
                styles.primaryButton,
                (isSubmitting || passwordChangeCode.length !== 6 || passwordChangePassword.length < 14) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              {isSubmitting
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.primaryButtonText}>Update password</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={cancelPasswordChange} style={styles.loginSecondaryButton}>
              <Text style={styles.loginSecondaryText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={requestPasswordChangeCode}
            style={({ pressed }) => [styles.passwordChangeButton, pressed && styles.buttonPressed]}
          >
            {isSubmitting
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={styles.passwordChangeButtonText}>Change password</Text>}
          </Pressable>
        )}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.loginError}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={signOut}
        style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
      >
        {isSubmitting
          ? <ActivityIndicator color={colors.red} />
          : <Text style={styles.signOutText}>Sign out</Text>}
      </Pressable>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

async function restoreSession(): Promise<AuthSession | null> {
  try {
    const stored = await SecureStore.getItemAsync(sessionStorageKey);
    if (!stored) return null;
    const previous = JSON.parse(stored) as AuthSession;
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${previous.accessToken}` },
    });
    if (response.ok) {
      const result = await response.json() as { user: RiderUser };
      if (result.user.role !== 'RIDER') {
        await SecureStore.deleteItemAsync(sessionStorageKey);
        return null;
      }
      return { ...previous, user: result.user };
    }
    if (response.status !== 401) return null;

    const refreshed = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: previous.refreshToken }),
    });
    if (!refreshed.ok) {
      await SecureStore.deleteItemAsync(sessionStorageKey);
      return null;
    }
    const next = await refreshed.json() as AuthSession;
    if (next.user.role !== 'RIDER') {
      await SecureStore.deleteItemAsync(sessionStorageKey);
      return null;
    }
    await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

async function fetchRiderWorkspace(accessToken: string): Promise<RiderWorkspace> {
  const response = await fetch(`${apiBaseUrl}/rider/workspace`, {
    headers: { authorization: ['Bearer', accessToken].join(' ') },
  });
  const result = await response.json() as {
    data?: RiderWorkspace;
    error?: { message?: string };
  };
  if (!response.ok || !result.data) {
    throw new Error(result.error?.message ?? 'Could not load your rider workday. Try again.');
  }
  return result.data;
}

async function fetchRiderTrips(accessToken: string): Promise<RiderTrip[]> {
  const response = await fetch(`${apiBaseUrl}/trips?limit=50`, {
    headers: { authorization: ['Bearer', accessToken].join(' ') },
  });
  const result = await response.json() as {
    data?: RiderTrip[];
    error?: { message?: string };
  };
  if (!response.ok || !result.data) {
    throw new Error(result.error?.message ?? 'Could not load your trip history. Try again.');
  }
  return result.data;
}

function createTripIdempotencyKey(): string {
  return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function decodePolyline(encoded: string): MapCoordinate[] {
  const coordinates: MapCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return [];
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) return [];
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return [];
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    coordinates.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return coordinates;
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1000
    ? `${distanceMeters} m`
    : `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function formatTripTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
}

function formatTripDate(value: string): string {
  return new Date(value).toLocaleString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFare(value: string | null): string {
  return value === null
    ? '—'
    : Number(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface AuthResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: RiderUser;
  verificationRequired?: boolean;
  verificationChannel?: 'email' | 'phone';
  error?: { code: string; message: string };
}

function Text(props: TextProps) {
  return (
    <NativeText
      {...props}
      style={[{ fontFamily: Platform.OS === 'android' ? 'sans-serif' : undefined }, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, paddingTop: androidTopInset, backgroundColor: colors.canvas },
  loadingScreen: {
    flex: 1,
    paddingTop: androidTopInset,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    backgroundColor: colors.canvas,
  },
  loadingText: { color: colors.muted, fontSize: 14 },
  loginScreen: { flex: 1, paddingTop: androidTopInset, backgroundColor: colors.canvas },
  loginKeyboard: { flex: 1 },
  loginContent: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 20 },
  loginBrand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: {
    width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  brandLetter: { color: colors.white, fontSize: 21, fontWeight: '800' },
  loginBrandName: { color: colors.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  loginIntro: { marginTop: 42 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  loginTitle: { marginTop: 10, color: colors.ink, fontSize: 34, fontWeight: '700', letterSpacing: -1.1 },
  loginDescription: { maxWidth: 340, marginTop: 9, color: colors.muted, fontSize: 14, lineHeight: 21 },
  loginCard: {
    marginTop: 27, padding: 19, borderRadius: 7, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.white, elevation: 1,
  },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  passwordLabel: { marginTop: 17 },
  input: {
    height: 51, marginTop: 8, paddingHorizontal: 13, borderRadius: 4,
    borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 15,
    backgroundColor: colors.white,
  },
  loginError: {
    marginTop: 13, padding: 11, borderRadius: 4, color: colors.red,
    backgroundColor: colors.dangerSoft, fontSize: 13, lineHeight: 19,
  },
  primaryButton: {
    height: 50, marginTop: 19, alignItems: 'center', justifyContent: 'center',
    borderRadius: 4, backgroundColor: colors.primary,
  },
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.82 },
  loginHelp: { marginTop: 15, color: colors.muted, fontSize: 12, textAlign: 'center' },
  loginNotice: { marginTop: 12, color: colors.primaryDark, fontSize: 12, lineHeight: 18 },
  loginSecondaryButton: { minHeight: 40, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  loginSecondaryText: { color: colors.primaryDark, fontSize: 13, fontWeight: '600' },
  loginFooter: { marginTop: 'auto', paddingTop: 20, color: colors.muted, fontSize: 11, textAlign: 'center' },
  topBar: {
    height: 62, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line,
    backgroundColor: colors.white,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMarkSmall: {
    width: 31, height: 31, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  brandLetterSmall: { color: colors.white, fontSize: 16, fontWeight: '800' },
  brandName: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  avatar: {
    width: 36, height: 36, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  avatarText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 30 },
  dateLabel: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  greeting: { marginTop: 7, color: colors.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  pageSubtitle: { marginTop: 4, color: colors.muted, fontSize: 14 },
  welcomeCard: {
    marginTop: 19, paddingVertical: 5, backgroundColor: colors.canvas,
  },
  welcomeTop: { flexDirection: 'row', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10,
    paddingVertical: 6, borderRadius: 3, backgroundColor: colors.primarySoft,
  },
  statusDot: { width: 7, height: 7, borderRadius: 1, backgroundColor: colors.accent },
  statusText: { color: colors.primaryDark, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  welcomeTitle: { marginTop: 14, color: colors.ink, fontSize: 25, fontWeight: '700' },
  welcomeBody: { marginTop: 7, color: colors.muted, fontSize: 13, lineHeight: 20 },
  sectionTitle: { marginTop: 24, marginBottom: 11, color: colors.ink, fontSize: 16, fontWeight: '700' },
  featureCard: {
    minHeight: 78, marginBottom: 10, padding: 13, flexDirection: 'row', alignItems: 'center',
    gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 5, backgroundColor: colors.white,
  },
  featureIcon: { width: 43, height: 43, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  featureIconText: { color: colors.primary, fontSize: 21, fontWeight: '800' },
  featureCopy: { flex: 1 },
  featureTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  featureDescription: { marginTop: 4, color: colors.muted, fontSize: 11, lineHeight: 16 },
  chevron: { color: colors.muted, fontSize: 25 },
  workdayCard: {
    marginTop: 12, padding: 16, borderRadius: 5, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.white,
  },
  workdayTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  workdayVehicle: { marginTop: 11, color: colors.primaryDark, fontSize: 15, fontWeight: '700' },
  workdayDescription: { marginTop: 7, color: colors.muted, fontSize: 12, lineHeight: 18 },
  workdayLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  workdayButton: {
    minHeight: 44, marginTop: 14, alignItems: 'center', justifyContent: 'center',
    borderRadius: 4,
  },
  startShiftButton: { backgroundColor: colors.primary },
  startShiftButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  endShiftButton: { borderWidth: 1, borderColor: '#f1b8b2', backgroundColor: colors.white },
  endShiftButtonText: { color: colors.red, fontSize: 14, fontWeight: '700' },
  tripActionCard: {
    marginTop: 20, padding: 16, borderRadius: 5, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.white,
  },
  tripVehicle: { marginTop: 8, marginBottom: 18, color: colors.muted, fontSize: 12 },
  tripActionDescription: { marginTop: 8, color: colors.muted, fontSize: 12, lineHeight: 18 },
  tripFareInput: {
    height: 48, marginTop: 8, paddingHorizontal: 13, borderRadius: 4,
    borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 16,
    backgroundColor: colors.white,
  },
  tripPrimaryButton: {
    minHeight: 46, marginTop: 15, alignItems: 'center', justifyContent: 'center',
    borderRadius: 4, backgroundColor: colors.primary,
  },
  tripLoading: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tripHistoryCard: {
    marginBottom: 9, padding: 15, borderRadius: 5, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.white,
  },
  tripHistoryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tripHistoryVehicle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  tripFareValue: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  tripHistoryDate: { marginTop: 7, color: colors.muted, fontSize: 11 },
  mapNotice: {
    marginTop: 18, padding: 16, borderRadius: 5, backgroundColor: colors.primarySoft,
  },
  mapNoticeTitle: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  mapNoticeBody: { marginTop: 5, color: colors.primaryDark, fontSize: 11, lineHeight: 17 },
  mapLocationButton: {
    minHeight: 44, marginTop: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 4, backgroundColor: colors.white,
  },
  mapLocationButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  mapLocationStatus: { marginTop: 6, color: colors.muted, fontSize: 11, textAlign: 'center' },
  inputDisabled: { opacity: 0.6 },
  placeSuggestion: {
    padding: 13, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.white,
  },
  placeSuggestionText: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  mapSpinner: { marginTop: 10 },
  mapContainer: {
    height: 360, marginTop: 14, overflow: 'hidden', borderRadius: 5,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.line,
  },
  mapView: { flex: 1 },
  mapAttribution: {
    position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.9)',
  },
  mapAttributionText: { color: colors.primaryDark, fontSize: 9, fontWeight: '700' },
  destinationCard: {
    marginTop: 12, padding: 14, borderRadius: 5, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.white,
  },
  destinationLabel: { color: colors.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  destinationName: { marginTop: 5, color: colors.ink, fontSize: 13, fontWeight: '700' },
  routeCard: {
    marginTop: 9, padding: 14, borderWidth: 1, borderColor: colors.line,
    borderRadius: 5, backgroundColor: colors.white,
  },
  routeCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  mapDisclaimer: { marginTop: 14, color: colors.muted, fontSize: 10, lineHeight: 15 },
  setupCard: {
    marginTop: 14, padding: 17, borderRadius: 5, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.white,
  },
  setupTitle: { marginBottom: 15, color: colors.ink, fontSize: 15, fontWeight: '800' },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  setupCheck: { width: 26, height: 26, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  setupCheckText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  setupPending: { width: 26, height: 26, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  setupPendingText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  setupCopy: { flex: 1 },
  setupStepTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  setupStepBody: { marginTop: 3, color: colors.muted, fontSize: 10, lineHeight: 15 },
  stepDone: { color: colors.primary, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  stepWait: { color: colors.accent, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  setupDivider: { height: 1, marginVertical: 13, marginLeft: 37, backgroundColor: colors.line },
  safeNote: { marginTop: 19, color: colors.muted, fontSize: 11, textAlign: 'center' },
  emptyCard: {
    marginTop: 25, paddingHorizontal: 24, paddingVertical: 31, alignItems: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 5, backgroundColor: colors.white,
  },
  emptyIcon: { width: 57, height: 57, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  emptyIconText: { color: colors.primary, fontSize: 27, fontWeight: '700' },
  emptyTitle: { marginTop: 17, color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyBody: { marginTop: 9, color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  infoCard: { marginTop: 15, padding: 17, borderRadius: 5, backgroundColor: colors.primarySoft },
  infoTitle: { marginBottom: 10, color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  infoLine: { marginTop: 5, color: colors.primaryDark, fontSize: 12 },
  profileCard: {
    marginTop: 20, paddingVertical: 22, alignItems: 'center', borderRadius: 5,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white,
  },
  profileAvatar: { width: 68, height: 68, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  profileInitials: { color: colors.primary, fontSize: 23, fontWeight: '800' },
  profileName: { marginTop: 13, color: colors.ink, fontSize: 18, fontWeight: '800' },
  profileRole: { marginTop: 5, color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  detailsCard: { marginTop: 13, paddingHorizontal: 16, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  passwordChangeCard: { marginTop: 13, padding: 16, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  passwordChangeDescription: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  passwordChangeButton: { minHeight: 46, marginTop: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: 4 },
  passwordChangeButtonText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  detailRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailLabel: { color: colors.muted, fontSize: 12 },
  detailValue: { maxWidth: '58%', color: colors.ink, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  detailDivider: { height: 1, backgroundColor: colors.line },
  signOutButton: {
    height: 51, marginTop: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#f1b8b2', borderRadius: 4, backgroundColor: colors.white,
  },
  signOutText: { color: colors.red, fontSize: 14, fontWeight: '800' },
  inlineError: { marginTop: 12, color: colors.red, fontSize: 12 },
  tabBar: {
    height: 70, paddingHorizontal: 7, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  tab: { flex: 1, marginHorizontal: 4, marginVertical: 6, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 4 },
  tabActive: { backgroundColor: colors.primarySoft },
  tabIcon: { color: '#8a8886', fontSize: 20, lineHeight: 24 },
  tabIconActive: { color: colors.primary, fontWeight: '800' },
  tabLabel: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: colors.primary, fontWeight: '800' },
});
