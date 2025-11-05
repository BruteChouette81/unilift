import { ScrollView, StyleSheet } from 'react-native';

import RideCard from '@/components/ridecard';
import { ThemedView } from '@/components/themed-view';
import { Text } from 'react-native';

export default function TabTwoScreen() {
  const mockRides = [
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.9, destination: "University Campus", seats: 3, time: "8:30 AM", distance: "2.5 km", level: 12, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.7, destination: "Downtown Bars", seats: 2, time: "9:00 PM", distance: "3.8 km", level: 8, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 5.0, destination: "North Campus", seats: 4, time: "7:45 AM", distance: "1.2 km", level: 15, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.8, destination: "Student District", seats: 1, time: "10:30 PM", distance: "4.1 km", level: 10 , onPress: () => {}},
  ];
  
  return (
    <ScrollView>
        <Text>Find rides near you</Text>

            <ThemedView style={styles.rideList}>
                      {mockRides.map((ride, index) => (
                        <RideCard key={index} {...ride} />
                      ))}
                    </ThemedView>
          
      
    </ScrollView>
  );
}

const styles = StyleSheet.create({
   container: {
    paddingBottom: 96, // ~pb-24
    paddingHorizontal: 16,
    gap: 24, // space-y-6
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  nearbyContainer: {
    marginTop: 8,
  },
  rideList: {
    gap: 12,
  },
});
